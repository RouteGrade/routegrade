"""Migration-chain invariants.

These run offline, with no database. They exist because of a real production
outage on 2026-07-28: prod sat four migrations behind head, `saved_routes` was
missing a column the ORM selected, and every saved-routes request 500'd. Nothing
in CI or the deploy noticed, because nothing was checking.

Two of those failure modes can be caught without a database at all, so they are
caught here. The third — a *deployed* database drifting from head — needs a live
connection and lives in `scripts/check_schema_drift.py`.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def script_directory() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(API_ROOT / "alembic.ini")))


def test_exactly_one_head(script_directory: ScriptDirectory) -> None:
    """Two heads means two people branched the chain and nobody merged it.

    `alembic upgrade head` fails outright in that state, so this is worth
    catching in CI rather than at deploy time.
    """
    heads = script_directory.get_heads()
    assert len(heads) == 1, f"expected a single migration head, found {heads}"


def test_every_revision_id_fits_the_version_column(
    script_directory: ScriptDirectory,
) -> None:
    """A revision id longer than `version_num` half-applies the migration.

    This is the bug that bit production: alembic applied the DDL, then failed
    writing the 34-character id into a VARCHAR(32) column, leaving the database
    in a state no `upgrade` could recover without hand-editing. `env.py` now
    widens the column, and this pins revision ids to whatever it declares.
    """
    from app.db.alembic_meta import VERSION_NUM_LENGTH

    too_long = {
        rev.revision: len(rev.revision)
        for rev in script_directory.walk_revisions()
        if len(rev.revision) > VERSION_NUM_LENGTH
    }
    assert not too_long, (
        f"revision ids exceed the {VERSION_NUM_LENGTH}-char version_num column: "
        f"{too_long}"
    )


def test_chain_is_linear_and_connected(script_directory: ScriptDirectory) -> None:
    """Every revision links to one that exists, ending at a single base."""
    revisions = list(script_directory.walk_revisions())
    known = {rev.revision for rev in revisions}

    bases = []
    for rev in revisions:
        down = rev.down_revision
        if down is None:
            bases.append(rev.revision)
            continue
        # A tuple here means a merge revision, which we don't use and which
        # would make "one linear history" untrue.
        assert isinstance(down, str), f"{rev.revision} has a non-linear parent: {down}"
        assert down in known, f"{rev.revision} points at unknown parent {down!r}"

    assert len(bases) == 1, f"expected exactly one base revision, found {bases}"
