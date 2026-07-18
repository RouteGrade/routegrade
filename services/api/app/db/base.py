"""SQLAlchemy declarative base for RouteGrade operational models."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Common declarative base. Kept intentionally minimal."""


# Importing models here ensures they are registered on `Base.metadata` when
# something imports `app.db.base` (e.g. Alembic env, tests).
from app.db.models import run, saved_route, user_profile  # noqa: E402, F401
