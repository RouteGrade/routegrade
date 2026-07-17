"""SQLAlchemy engine, session factory, and per-request dependency."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _init() -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        return
    settings = get_settings()
    # `schema_translate_map={"public": None}` makes tables declared with
    # `schema="public"` emit unqualified SQL. For PostgreSQL that resolves back
    # to `public.<table>` via the default search_path (no behavior change). For
    # SQLite (used in the demo/tests), it side-steps the fact that SQLite has no
    # schema concept.
    _engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        future=True,
    ).execution_options(schema_translate_map={"public": None})
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def get_engine() -> Engine:
    _init()
    assert _engine is not None
    return _engine


def get_sessionmaker() -> sessionmaker[Session]:
    _init()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request, always closed."""

    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def dispose() -> None:
    """Dispose of the engine's connection pool (called on shutdown)."""

    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
