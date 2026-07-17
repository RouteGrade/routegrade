"""Data-access helpers for `public.saved_routes`.

Every function is owner-scoped: `user_id` is part of every predicate so one
user can never observe or mutate another user's rows, independent of RLS.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.saved_route import SavedRoute


def list_for_user(session: Session, user_id: uuid.UUID) -> list[SavedRoute]:
    return list(
        session.execute(
            select(SavedRoute)
            .where(SavedRoute.user_id == user_id)
            .order_by(SavedRoute.created_at.desc())
        ).scalars()
    )


def get_for_user(
    session: Session, *, user_id: uuid.UUID, route_id: uuid.UUID
) -> SavedRoute | None:
    return session.execute(
        select(SavedRoute).where(
            SavedRoute.id == route_id, SavedRoute.user_id == user_id
        )
    ).scalar_one_or_none()


def upsert_for_user(
    session: Session,
    *,
    user_id: uuid.UUID,
    route_id: uuid.UUID,
    fields: dict[str, Any],
) -> tuple[SavedRoute, bool]:
    """Save-or-replace keyed on (id, user_id). Returns (route, created).

    If the id exists but belongs to another user, we treat it as a collision
    and refuse (the caller maps this to 409) rather than leaking existence.
    """

    existing_any_owner = session.execute(
        select(SavedRoute).where(SavedRoute.id == route_id)
    ).scalar_one_or_none()

    if existing_any_owner is not None and existing_any_owner.user_id != user_id:
        raise RouteIdCollision(route_id)

    if existing_any_owner is None:
        route = SavedRoute(id=route_id, user_id=user_id, **fields)
        session.add(route)
        session.flush()
        return route, True

    for key, value in fields.items():
        setattr(existing_any_owner, key, value)
    session.flush()
    return existing_any_owner, False


def delete_for_user(session: Session, *, user_id: uuid.UUID, route_id: uuid.UUID) -> bool:
    route = get_for_user(session, user_id=user_id, route_id=route_id)
    if route is None:
        return False
    session.delete(route)
    session.flush()
    return True


class RouteIdCollision(Exception):
    """The route id is already owned by a different user."""

    def __init__(self, route_id: uuid.UUID) -> None:
        super().__init__(f"saved route id collision: {route_id}")
        self.route_id = route_id
