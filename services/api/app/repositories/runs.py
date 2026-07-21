"""Data-access helpers for `public.runs`.

Every function is owner-scoped: `user_id` is part of every predicate so one
user can never observe or mutate another user's rows, independent of RLS.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.run import Run


def list_for_user(session: Session, user_id: uuid.UUID) -> list[Run]:
    return list(
        session.execute(
            select(Run)
            .where(Run.user_id == user_id)
            .order_by(Run.started_at.desc())
        ).scalars()
    )


def get_for_user(session: Session, *, user_id: uuid.UUID, run_id: uuid.UUID) -> Run | None:
    return session.execute(
        select(Run).where(Run.id == run_id, Run.user_id == user_id)
    ).scalar_one_or_none()


def upsert_for_user(
    session: Session,
    *,
    user_id: uuid.UUID,
    run_id: uuid.UUID,
    fields: dict[str, Any],
) -> tuple[Run, bool]:
    """Save-or-replace keyed on (id, user_id). Returns (run, created).

    The client generates the run id, so a retried save after a flaky network
    lands on the same row instead of duplicating the run. If the id exists but
    belongs to another user, we treat it as a collision and refuse (the caller
    maps this to 409) rather than leaking existence.
    """

    existing_any_owner = session.execute(
        select(Run).where(Run.id == run_id)
    ).scalar_one_or_none()

    if existing_any_owner is not None and existing_any_owner.user_id != user_id:
        raise RunIdCollision(run_id)

    if existing_any_owner is None:
        run = Run(id=run_id, user_id=user_id, **fields)
        session.add(run)
        try:
            session.flush()
        except IntegrityError as exc:  # pragma: no cover — race with a concurrent insert
            # Another writer beat us to this id between the SELECT and INSERT.
            # Map to the same collision the caller already handles as 409.
            raise RunIdCollision(run_id) from exc
        return run, True

    for key, value in fields.items():
        setattr(existing_any_owner, key, value)
    session.flush()
    return existing_any_owner, False


def delete_for_user(session: Session, *, user_id: uuid.UUID, run_id: uuid.UUID) -> bool:
    run = get_for_user(session, user_id=user_id, run_id=run_id)
    if run is None:
        return False
    session.delete(run)
    session.flush()
    return True


class RunIdCollision(Exception):
    """The run id is already owned by a different user."""

    def __init__(self, run_id: uuid.UUID) -> None:
        super().__init__(f"run id collision: {run_id}")
        self.run_id = run_id
