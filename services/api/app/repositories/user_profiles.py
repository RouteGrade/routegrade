"""Small data-access helpers for `public.user_profiles`."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.user_profile import UserProfile


def get_by_user_id(session: Session, user_id: uuid.UUID) -> UserProfile | None:
    return session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    ).scalar_one_or_none()


def upsert_from_claims(
    session: Session,
    *,
    user_id: uuid.UUID,
    email: str,
    auth_provider: str,
    display_name: str | None,
    avatar_url: str | None,
) -> tuple[UserProfile, bool]:
    """Race-safe insert-or-refresh keyed on user_id.

    Returns (profile, created). `created` is True iff this call inserted the row.

    Concurrency: if two first-time requests race, both hit `get_by_user_id() is
    None` and both attempt INSERT. The primary-key constraint guarantees one
    wins; the loser catches IntegrityError, rolls back its savepoint, and falls
    through to the update path. This is dialect-agnostic (works with SQLite in
    tests and PostgreSQL in production).
    """

    existing = get_by_user_id(session, user_id)
    if existing is None:
        profile = UserProfile(
            user_id=user_id,
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            auth_provider=auth_provider,
        )
        session.add(profile)
        try:
            with session.begin_nested():
                session.flush()
        except IntegrityError:
            # Lost the race — fetch the row the other transaction inserted.
            session.expunge(profile)
            existing = get_by_user_id(session, user_id)
            if existing is None:
                raise
            profile = existing
            _sync_system_fields(profile, email=email, auth_provider=auth_provider, avatar_url=avatar_url)
            session.flush()
            return profile, False
        return profile, True

    _sync_system_fields(existing, email=email, auth_provider=auth_provider, avatar_url=avatar_url)
    session.flush()
    return existing, False


def _sync_system_fields(
    profile: UserProfile,
    *,
    email: str,
    auth_provider: str,
    avatar_url: str | None,
) -> None:
    """Refresh system-owned fields on an existing row. Never touches display_name."""

    if profile.email != email:
        profile.email = email
    if profile.auth_provider != auth_provider:
        profile.auth_provider = auth_provider
    if profile.avatar_url != avatar_url:
        profile.avatar_url = avatar_url


def update_display_name(
    session: Session, *, user_id: uuid.UUID, display_name: str | None
) -> UserProfile | None:
    profile = get_by_user_id(session, user_id)
    if profile is None:
        return None
    profile.display_name = display_name
    session.flush()
    return profile
