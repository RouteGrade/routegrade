"""Authenticated run-history endpoints under `/v1/users/me/runs`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.rate_limit_deps import enforce_runs_write_rate_limit
from app.auth.dependencies import CurrentClaims
from app.db.session import get_db
from app.repositories import runs as repo
from app.repositories.runs import RunIdCollision
from app.schemas.runs import RunEnvelope, RunList, RunRead, RunSave

router = APIRouter(prefix="/v1/users/me/runs", tags=["runs"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail={"code": "run_not_found", "message": "Run not found"},
)


@router.get("", response_model=RunList)
def list_runs(
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> RunList:
    runs = repo.list_for_user(session, claims.user_id)
    return RunList(runs=[RunRead.model_validate(r) for r in runs])


@router.get("/{run_id}", response_model=RunRead)
def get_run(
    run_id: uuid.UUID,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> RunRead:
    run = repo.get_for_user(session, user_id=claims.user_id, run_id=run_id)
    if run is None:
        raise _NOT_FOUND
    return RunRead.model_validate(run)


@router.put(
    "/{run_id}",
    response_model=RunEnvelope,
    dependencies=[Depends(enforce_runs_write_rate_limit)],
)
def save_run(
    run_id: uuid.UUID,
    payload: RunSave,
    claims: CurrentClaims,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> RunEnvelope:
    """Idempotently persist a completed run under its client-issued id."""

    fields = payload.model_dump()
    fields["splits"] = [split.model_dump() for split in payload.splits]
    fields["path"] = payload.path.model_dump() if payload.path is not None else None
    try:
        run, created = repo.upsert_for_user(
            session, user_id=claims.user_id, run_id=run_id, fields=fields
        )
        session.commit()
    except RunIdCollision:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "run_id_conflict", "message": "Run id is unavailable"},
        ) from None
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save run",
        ) from None

    if created:
        response.status_code = status.HTTP_201_CREATED
    return RunEnvelope(run=RunRead.model_validate(run), created=created)


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(
    run_id: uuid.UUID,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        deleted = repo.delete_for_user(session, user_id=claims.user_id, run_id=run_id)
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete run",
        ) from None

    if not deleted:
        raise _NOT_FOUND
    return Response(status_code=status.HTTP_204_NO_CONTENT)
