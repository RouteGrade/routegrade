"""User profile endpoints under `/v1/users/me`."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentClaims
from app.db.session import get_db
from app.repositories import user_profiles as repo
from app.schemas.users import UserProfileEnvelope, UserProfileRead, UserProfileUpdate
from app.services.users import provision_profile

router = APIRouter(prefix="/v1/users", tags=["users"])


@router.put(
    "/me",
    response_model=UserProfileEnvelope,
    status_code=status.HTTP_200_OK,
)
def put_me(
    claims: CurrentClaims,
    response: Response,
    session: Annotated[Session, Depends(get_db)],
) -> UserProfileEnvelope:
    """Idempotently provision the current user's RouteGrade profile."""

    try:
        profile, created = provision_profile(session, claims)
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not provision profile",
        ) from None

    if created:
        response.status_code = status.HTTP_201_CREATED
    return UserProfileEnvelope(user=UserProfileRead.model_validate(profile), created=created)


@router.get("/me", response_model=UserProfileRead)
def get_me(
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> UserProfileRead:
    profile = repo.get_by_user_id(session, claims.user_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "profile_not_provisioned", "message": "Profile not yet provisioned"},
        )
    return UserProfileRead.model_validate(profile)


@router.patch("/me", response_model=UserProfileRead)
def patch_me(
    payload: UserProfileUpdate,
    claims: CurrentClaims,
    session: Annotated[Session, Depends(get_db)],
) -> UserProfileRead:
    try:
        profile = repo.update_display_name(
            session,
            user_id=claims.user_id,
            display_name=payload.display_name,
        )
        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "profile_not_provisioned", "message": "Profile not yet provisioned"},
            )
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update profile",
        ) from None

    return UserProfileRead.model_validate(profile)
