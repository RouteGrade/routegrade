"""Test-wide fixtures: safe env defaults, generated RSA test keys, in-memory DB."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

import pytest

# Set safe test env BEFORE any app modules import Settings.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_JWT_ISSUER", "https://test.supabase.co/auth/v1")
os.environ.setdefault(
    "SUPABASE_JWKS_URL", "https://test.supabase.co/auth/v1/.well-known/jwks.json"
)
os.environ.setdefault("SUPABASE_JWT_AUDIENCE", "authenticated")
os.environ.setdefault("SUPABASE_JWT_ALGORITHMS", "RS256")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")

import jwt  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jwt import PyJWKSet  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.models.run import Run  # noqa: E402
from app.db.models.saved_route import SavedRoute  # noqa: E402
from app.db.models.user_profile import UserProfile  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402


# ---------------------------------------------------------------------------
# JWT / JWKS fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def rsa_key() -> Any:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def kid() -> str:
    return "test-key-1"


def _b64url_uint(n: int) -> str:
    import base64

    length = (n.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode("ascii")


@pytest.fixture(scope="session")
def jwks_dict(rsa_key: Any, kid: str) -> dict[str, Any]:
    numbers = rsa_key.public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "RSA",
                "kid": kid,
                "alg": "RS256",
                "use": "sig",
                "n": _b64url_uint(numbers.n),
                "e": _b64url_uint(numbers.e),
            }
        ]
    }


class StubJWKSClient:
    """Test double: hands back a fixed PyJWKSet without touching the network."""

    def __init__(self, jwks: dict[str, Any]) -> None:
        self._jwks = PyJWKSet.from_dict(jwks)

    def get_signing_key(self, kid: str | None):  # noqa: D401
        for key in self._jwks.keys:
            if key.key_id == kid or kid is None:
                return key
        raise KeyError(kid)


# ---------------------------------------------------------------------------
# Database fixtures (SQLite for test isolation)
# ---------------------------------------------------------------------------


def _make_test_engine():
    """Create an in-memory SQLite engine with `public` schema translated to None.

    Our SQLAlchemy model targets `public.user_profiles` (PostgreSQL). SQLite has
    no notion of schemas, so we translate `public` to the default schema for the
    duration of the test.
    """

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    ).execution_options(schema_translate_map={"public": None})
    UserProfile.__table__.create(bind=engine)
    SavedRoute.__table__.create(bind=engine)
    Run.__table__.create(bind=engine)
    return engine


@pytest.fixture()
def db_session() -> Iterator:
    engine = _make_test_engine()
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


# ---------------------------------------------------------------------------
# FastAPI app + client
# ---------------------------------------------------------------------------


@pytest.fixture()
def app_with_overrides(jwks_dict: dict[str, Any]):
    get_settings.cache_clear()
    app = create_app()

    # Stub JWKS so no real HTTP call happens during tests.
    app.state.jwks_client = StubJWKSClient(jwks_dict)

    # Disable /plan rate limiting by default; rate-limit tests install their own.
    app.state.plan_rate_limiter = None

    # Use a fresh in-memory SQLite for each test.
    engine = _make_test_engine()
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        session = SessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield app
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


@pytest.fixture()
def client(app_with_overrides) -> Iterator[TestClient]:
    with TestClient(app_with_overrides) as c:
        yield c


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------


def make_token(
    rsa_key: Any,
    kid: str,
    *,
    sub: str | None = None,
    email: str = "runner@example.com",
    iss: str = "https://test.supabase.co/auth/v1",
    aud: str = "authenticated",
    role: str = "authenticated",
    exp_offset: int = 3600,
    alg: str = "RS256",
    user_metadata: dict[str, Any] | None = None,
    app_metadata: dict[str, Any] | None = None,
    extra_claims: dict[str, Any] | None = None,
    include_sub: bool = True,
) -> str:
    now = datetime.now(tz=timezone.utc)
    payload: dict[str, Any] = {
        "iss": iss,
        "aud": aud,
        "role": role,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=exp_offset)).timestamp()),
        "user_metadata": user_metadata or {},
        "app_metadata": app_metadata or {"provider": "email"},
    }
    if include_sub:
        payload["sub"] = sub or str(uuid.uuid4())
    if extra_claims:
        payload.update(extra_claims)

    private_pem = rsa_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(payload, private_pem, algorithm=alg, headers={"kid": kid})


@pytest.fixture()
def token_factory(rsa_key: Any, kid: str):
    def _make(**kwargs: Any) -> str:
        return make_token(rsa_key, kid, **kwargs)

    return _make
