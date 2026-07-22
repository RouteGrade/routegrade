"""Data-access helpers for `public.run_ratings`.

Every function is owner-scoped: `user_id` is part of every predicate so one
user can never observe or mutate another user's feedback, independent of RLS.
Identity for upsert is the `(user_id, run_id)` pair — one rating per run.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.run_rating import RunRating


def get_for_run(
    session: Session, *, user_id: uuid.UUID, run_id: uuid.UUID
) -> RunRating | None:
    return session.execute(
        select(RunRating).where(
            RunRating.user_id == user_id, RunRating.run_id == run_id
        )
    ).scalar_one_or_none()


def upsert_for_run(
    session: Session,
    *,
    user_id: uuid.UUID,
    run_id: uuid.UUID,
    fields: dict[str, Any],
) -> tuple[RunRating, bool]:
    """Save-or-replace the rating for one run. Returns (rating, created).

    Scoped to `(user_id, run_id)`, so a re-submitted rating updates the same
    row rather than duplicating it, and no cross-user collision is possible
    (unlike run ids, ratings are never addressed by a shared client id).
    """

    existing = get_for_run(session, user_id=user_id, run_id=run_id)
    if existing is None:
        rating = RunRating(id=uuid.uuid4(), user_id=user_id, run_id=run_id, **fields)
        session.add(rating)
        session.flush()
        return rating, True

    for key, value in fields.items():
        setattr(existing, key, value)
    session.flush()
    return existing, False


def delete_for_run(session: Session, *, user_id: uuid.UUID, run_id: uuid.UUID) -> bool:
    rating = get_for_run(session, user_id=user_id, run_id=run_id)
    if rating is None:
        return False
    session.delete(rating)
    session.flush()
    return True
