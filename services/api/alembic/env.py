"""Alembic environment for the RouteGrade operational database."""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make the services/api/ directory importable so `app.*` resolves.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Load DATABASE_URL (and friends) from services/api/.env if present.
_env_path = Path(__file__).resolve().parents[1] / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

from app.db.base import Base  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Resolve the database URL from the environment so we never commit credentials.
database_url = os.getenv("DATABASE_URL")
if not database_url:
    raise RuntimeError(
        "DATABASE_URL must be set in the environment to run Alembic migrations."
    )
config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def _include_object(object_, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]
    """Only manage RouteGrade's operational tables — never Supabase auth schema."""

    if type_ == "table":
        schema = getattr(object_, "schema", None) or "public"
        if schema != "public":
            return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=_include_object,
        include_schemas=False,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=_include_object,
            include_schemas=False,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
