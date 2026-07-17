"""User-profile provisioning service."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.db.models.user_profile import UserProfile
from app.repositories import user_profiles as repo


def provision_profile(session: Session, claims: Claims) -> tuple[UserProfile, bool]:
    """Idempotently create/refresh the caller's profile.

    - First call inserts a row seeded from verified provider metadata.
    - Subsequent calls refresh system-owned fields (email, provider, avatar) from
      the token. `display_name` is preserved once set — the user owns that field
      through PATCH.
    """

    return repo.upsert_from_claims(
        session,
        user_id=claims.user_id,
        email=claims.email,
        auth_provider=claims.provider,
        display_name=claims.display_name,
        avatar_url=claims.avatar_url,
    )
