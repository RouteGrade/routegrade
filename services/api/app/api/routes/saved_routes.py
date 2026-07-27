"""Authenticated saved-route endpoints under `/v1/users/me/routes`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.rate_limit_deps import enforce_saved_routes_write_rate_limit
from app.auth.dependencies import CurrentClaims
from app.db.session import get_db
from app.repositories import route_feedback as feedback_repo
from app.repositories import saved_routes as repo
from app.repositories.saved_routes import RouteIdCollision
from app.schemas.route_feedback import (
    RouteFeedbackEnvelope,
    RouteFeedbackRead,
    RouteFeedbackSave,
)
from app.schemas.routes import (
    SavedRouteEnvelope,
    SavedRouteList,
    SavedRouteRead,
    SavedRouteSave,
)

router = APIRouter(prefix="/v1/users/me/routes", tags=["saved-routes"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail={"code": "route_not_found", "message": "Saved route not found"},
)

_FEEDBACK_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail={"code": "feedback_not_found", "message": "Route feedback not found"},
)


@router.get("", response_model=SavedRouteList)
def list_routes(
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> SavedRouteList:
    routes = repo.list_for_user(session, claims.user_id)
    return SavedRouteList(routes=[SavedRouteRead.model_validate(r) for r in routes])


@router.get("/{route_id}", response_model=SavedRouteRead)
def get_route(
    route_id: uuid.UUID,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> SavedRouteRead:
    route = repo.get_for_user(session, user_id=claims.user_id, route_id=route_id)
    if route is None:
        raise _NOT_FOUND
    return SavedRouteRead.model_validate(route)


@router.put(
    "/{route_id}",
    response_model=SavedRouteEnvelope,
    dependencies=[Depends(enforce_saved_routes_write_rate_limit)],
)
def save_route(
    route_id: uuid.UUID,
    payload: SavedRouteSave,
    claims: CurrentClaims,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> SavedRouteEnvelope:
    """Idempotently persist a planned candidate under its planner-issued id."""

    fields = payload.model_dump()
    fields["geometry"] = payload.geometry.model_dump()
    try:
        route, created = repo.upsert_for_user(
            session, user_id=claims.user_id, route_id=route_id, fields=fields
        )
        session.commit()
    except RouteIdCollision:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "route_id_conflict", "message": "Route id is unavailable"},
        ) from None
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save route",
        ) from None

    if created:
        response.status_code = status.HTTP_201_CREATED
    return SavedRouteEnvelope(route=SavedRouteRead.model_validate(route), created=created)


@router.delete("/{route_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route(
    route_id: uuid.UUID,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        deleted = repo.delete_for_user(session, user_id=claims.user_id, route_id=route_id)
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete route",
        ) from None

    if not deleted:
        raise _NOT_FOUND
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Route-view grade feedback — "is this grade accurate?" (scoring calibration). #
# --------------------------------------------------------------------------- #


@router.get("/{route_id}/feedback", response_model=RouteFeedbackRead)
def get_route_feedback(
    route_id: uuid.UUID,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> RouteFeedbackRead:
    feedback = feedback_repo.get_for_route(
        session, user_id=claims.user_id, route_id=route_id
    )
    if feedback is None:
        raise _FEEDBACK_NOT_FOUND
    return RouteFeedbackRead.model_validate(feedback)


@router.put(
    "/{route_id}/feedback",
    response_model=RouteFeedbackEnvelope,
    dependencies=[Depends(enforce_saved_routes_write_rate_limit)],
)
def save_route_feedback(
    route_id: uuid.UUID,
    payload: RouteFeedbackSave,
    claims: CurrentClaims,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> RouteFeedbackEnvelope:
    """Idempotently persist the runner's grade verdict for one route.

    Keyed on `(user_id, route_id)`, so re-submitting overwrites the same row. We
    do not require the route to already be saved server-side — the client may
    submit a verdict alongside the save, and feedback with no matching route is
    simply excluded from calibration joins downstream.
    """

    fields = payload.model_dump()
    try:
        feedback, created = feedback_repo.upsert_for_route(
            session, user_id=claims.user_id, route_id=route_id, fields=fields
        )
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save feedback",
        ) from None

    if created:
        response.status_code = status.HTTP_201_CREATED
    return RouteFeedbackEnvelope(
        feedback=RouteFeedbackRead.model_validate(feedback), created=created
    )


@router.delete("/{route_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def delete_route_feedback(
    route_id: uuid.UUID,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        deleted = feedback_repo.delete_for_route(
            session, user_id=claims.user_id, route_id=route_id
        )
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete feedback",
        ) from None

    if not deleted:
        raise _FEEDBACK_NOT_FOUND
    return Response(status_code=status.HTTP_204_NO_CONTENT)
