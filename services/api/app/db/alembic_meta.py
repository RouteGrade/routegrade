"""Facts about the migration chain that both Alembic and the tests need.

Lives here rather than in `alembic/env.py` because that file is a script
Alembic executes, not an importable module — importing it runs migrations.
"""

from __future__ import annotations

# Alembic's default `version_num` column is VARCHAR(32), but this project uses
# long descriptive revision ids and "0006_add_saved_route_intersections" is 34
# characters. On 2026-07-28 that combination bit production: `alembic upgrade
# head` applies a migration and then fails *stamping* it, leaving the database
# half-migrated with no clean way forward.
#
# `alembic/env.py` passes this to `version_table_column_type` so a freshly
# created environment gets a column that fits, and
# `tests/test_migrations.py` pins every revision id to it.
VERSION_NUM_LENGTH = 64
