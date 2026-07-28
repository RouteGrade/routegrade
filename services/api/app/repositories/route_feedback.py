"""Data-access helpers for `public.route_feedback`.

Every function is owner-scoped: `user_id` is part of every predicate so one
user can never observe or mutate another user's feedback, independent of RLS.
Identity for upsert is the `(user_id, route_id)` pair — one verdict per route.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.route_feedback import RouteFeedback


def get_for_route(
    session: Session, *, user_id: uuid.UUID, route_id: uuid.UUID
) -> RouteFeedback | None:
    return session.execute(
        select(RouteFeedback).where(
            RouteFeedback.user_id == user_id, RouteFeedback.route_id == route_id
        )
    ).scalar_one_or_none()


def upsert_for_route(
    session: Session,
    *,
    user_id: uuid.UUID,
    route_id: uuid.UUID,
    fields: dict[str, Any],
) -> tuple[RouteFeedback, bool]:
    """Save-or-replace the feedback for one route. Returns (feedback, created).

    Scoped to `(user_id, route_id)`, so a re-submitted verdict updates the same
    row rather than duplicating it, and no cross-user collision is possible.
    """

    existing = get_for_route(session, user_id=user_id, route_id=route_id)
    if existing is None:
        feedback = RouteFeedback(
            id=uuid.uuid4(), user_id=user_id, route_id=route_id, **fields
        )
        session.add(feedback)
        session.flush()
        return feedback, True

    for key, value in fields.items():
        setattr(existing, key, value)
    session.flush()
    return existing, False


def delete_for_route(
    session: Session, *, user_id: uuid.UUID, route_id: uuid.UUID
) -> bool:
    feedback = get_for_route(session, user_id=user_id, route_id=route_id)
    if feedback is None:
        return False
    session.delete(feedback)
    session.flush()
    return True
