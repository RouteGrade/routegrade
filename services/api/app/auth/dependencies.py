"""FastAPI auth dependencies: verify Supabase JWT and produce typed Claims."""

from __future__ import annotations

import uuid
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from app.auth.claims import Claims
from app.auth.jwks import JWKSClient
from app.core.config import Settings, get_settings

bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


@lru_cache(maxsize=1)
def _default_jwks_client() -> JWKSClient:
    settings = get_settings()
    return JWKSClient(settings.supabase_jwks_url)


def get_jwks_client(request: Request) -> JWKSClient:
    """Allow tests to override the JWKS client via `app.state.jwks_client`."""

    override = getattr(request.app.state, "jwks_client", None)
    if override is not None:
        return override
    return _default_jwks_client()


def get_current_user_claims(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    jwks_client: Annotated[JWKSClient, Depends(get_jwks_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Claims:
    """Verify a Bearer JWT and return a typed subset of its claims.

    Fails with 401 for anything the caller could have gotten wrong: missing,
    malformed, expired, wrongly-signed, wrong-issuer, wrong-audience.
    """

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Missing or invalid Authorization header")

    token = credentials.credentials

    # 1. Parse the unverified header safely to pick the right signing key.
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized("Malformed token") from None

    kid = header.get("kid")
    alg = header.get("alg")

    if alg not in settings.supabase_jwt_algorithms:
        raise _unauthorized("Unsupported token algorithm")

    # 2. Fetch the matching signing key (with JWKS-miss refresh).
    try:
        signing_key = jwks_client.get_signing_key(kid)
    except KeyError:
        raise _unauthorized("Unknown token signing key") from None
    except Exception:  # pragma: no cover — network failures degrade to 401
        raise _unauthorized("Unable to verify token") from None

    # 3. Verify signature + registered claims.
    try:
        payload = jwt.decode(
            token,
            key=signing_key.key,
            algorithms=settings.supabase_jwt_algorithms,
            audience=settings.supabase_jwt_audience,
            issuer=settings.supabase_jwt_issuer,
            options={
                "require": ["exp", "iss", "aud", "sub"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_aud": True,
            },
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired") from None
    except jwt.InvalidIssuerError:
        raise _unauthorized("Invalid token issuer") from None
    except jwt.InvalidAudienceError:
        raise _unauthorized("Invalid token audience") from None
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid token") from None

    # 4. Enforce a UUID `sub` and that the role/audience is `authenticated`.
    sub = payload.get("sub")
    try:
        user_id = uuid.UUID(str(sub))
    except (ValueError, TypeError):
        raise _unauthorized("Invalid subject claim") from None

    role = payload.get("role")
    if role != "authenticated":
        raise _unauthorized("Token is not for an authenticated user")

    email = payload.get("email")
    if not isinstance(email, str) or not email:
        raise _unauthorized("Token missing email claim")

    try:
        return Claims(
            user_id=user_id,
            email=email,
            role=role,
            issuer=payload["iss"],
            audience=str(payload["aud"]),
            user_metadata=payload.get("user_metadata") or {},
            app_metadata=payload.get("app_metadata") or {},
        )
    except ValidationError:
        raise _unauthorized("Invalid token payload") from None


CurrentClaims = Annotated[Claims, Depends(get_current_user_claims)]
