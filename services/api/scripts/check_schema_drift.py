#!/usr/bin/env python3
"""Compare a live database's Alembic revision against the migration head.

Why this exists: on 2026-07-28 production sat four migrations behind head. The
ORM selected a column the database didn't have, every saved-routes request
500'd, and it stayed that way — undetected by CI, the deploy, or the smoke test
— until a human happened to open the Routes tab. Nothing was comparing the
deployed schema to the code's expectations. This does.

The offline half of the guard (single head, revision-id length, chain
integrity) is in `tests/test_migrations.py` and runs in CI without a database.
This half needs a live connection, so it runs where credentials exist: by hand,
or from `scripts/smoke-test.sh` when DATABASE_URL is set.

Usage:
    DATABASE_URL=postgresql://... python scripts/check_schema_drift.py
    python scripts/check_schema_drift.py --database-url postgresql://...

Exit codes:
    0  schema is at head
    1  drift — the database is not at head (or has no alembic_version at all)
    2  could not check (bad/missing URL, connection refused)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_CANNOT_CHECK = 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Defaults to $DATABASE_URL.",
    )
    args = parser.parse_args()

    if not args.database_url:
        print("SKIP  no DATABASE_URL given — cannot check schema drift")
        return EXIT_CANNOT_CHECK

    # Imported after sys.path is set up, and after the URL check so the script
    # stays useful (and fast) as a no-op when credentials aren't around.
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, text

    script = ScriptDirectory.from_config(Config(str(API_ROOT / "alembic.ini")))
    heads = script.get_heads()
    if len(heads) != 1:
        print(f"FAIL  migration chain has {len(heads)} heads: {heads}")
        return EXIT_CANNOT_CHECK
    head = heads[0]

    try:
        engine = create_engine(args.database_url, pool_pre_ping=True)
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).fetchall()
    except Exception as exc:
        # Broad on purpose. A missing driver raises ModuleNotFoundError, a bad
        # URL raises ArgumentError, an unreachable host raises OperationalError
        # — none of those mean "the schema has drifted", and reporting drift
        # for them would cry wolf. They mean "could not check", which is a
        # different exit code.
        #
        # The exception body is deliberately not printed: it can carry the
        # connection string, and this runs in CI logs.
        print(f"FAIL  could not read alembic_version ({type(exc).__name__})")
        return EXIT_CANNOT_CHECK

    if not rows:
        print(f"FAIL  alembic_version is empty; expected head {head!r}")
        return EXIT_DRIFT
    if len(rows) > 1:
        found = sorted(r[0] for r in rows)
        print(f"FAIL  alembic_version holds multiple revisions: {found}")
        return EXIT_DRIFT

    current = rows[0][0]
    if current != head:
        behind = [rev.revision for rev in script.iterate_revisions(head, current)]
        print(f"FAIL  database is at {current!r}, head is {head!r}")
        if behind:
            print(f"      unapplied: {', '.join(reversed(behind))}")
        print("      fix: cd services/api && DATABASE_URL=... uv run alembic upgrade head")
        return EXIT_DRIFT

    print(f"PASS  database is at head ({head})")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
