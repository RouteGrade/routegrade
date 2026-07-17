"""End-to-end demo: full authenticated lifecycle against the ASGI app in-process.

Runs the real FastAPI app with a stubbed JWKS (so we don't need a live Supabase
project) and an in-memory SQLite (so we don't need a live Postgres). Everything
between the ASGI layer and the database is production code.

Usage:
    uv run python demo_ms2_backend.py
"""

from __future__ import annotations

import base64
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Safe defaults so the settings loader doesn't fail on import.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SUPABASE_URL", "https://demo.supabase.co")
os.environ.setdefault("SUPABASE_JWT_ISSUER", "https://demo.supabase.co/auth/v1")
os.environ.setdefault(
    "SUPABASE_JWKS_URL", "https://demo.supabase.co/auth/v1/.well-known/jwks.json"
)
os.environ.setdefault("SUPABASE_JWT_AUDIENCE", "authenticated")
os.environ.setdefault("SUPABASE_JWT_ALGORITHMS", "RS256")

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt import PyJWKSet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models.user_profile import UserProfile
from app.db.session import get_db
from app.main import create_app


def b64url_uint(n: int) -> str:
    length = (n.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode("ascii")


def build_jwks(rsa_key, kid: str) -> dict:
    numbers = rsa_key.public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "RSA",
                "kid": kid,
                "alg": "RS256",
                "use": "sig",
                "n": b64url_uint(numbers.n),
                "e": b64url_uint(numbers.e),
            }
        ]
    }


class StubJWKS:
    def __init__(self, jwks: dict) -> None:
        self._set = PyJWKSet.from_dict(jwks)

    def get_signing_key(self, kid):
        for key in self._set.keys:
            if key.key_id == kid or kid is None:
                return key
        raise KeyError(kid)


def make_token(rsa_key, kid: str, *, sub: str, email: str, provider: str, name: str) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "iss": "https://demo.supabase.co/auth/v1",
        "aud": "authenticated",
        "role": "authenticated",
        "sub": sub,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
        "user_metadata": {"full_name": name, "avatar_url": f"https://cdn/{sub}.png"},
        "app_metadata": {"provider": provider, "providers": [provider]},
    }
    pem = rsa_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(payload, pem, algorithm="RS256", headers={"kid": kid})


def hr(title: str) -> None:
    print(f"\n=== {title} ===")


def show(resp) -> None:
    print(f"HTTP {resp.status_code}")
    try:
        print(json.dumps(resp.json(), indent=2, default=str))
    except ValueError:
        print(resp.text)


def main() -> int:
    # Real RSA key pair, stubbed JWKS, real in-memory DB.
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    kid = "demo-key"

    app = create_app()
    app.state.jwks_client = StubJWKS(build_jwks(rsa_key, kid))

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    ).execution_options(schema_translate_map={"public": None})
    UserProfile.__table__.create(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def _get_db_override():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db_override

    client = TestClient(app)

    alice = str(uuid.uuid4())
    bob = str(uuid.uuid4())

    alice_token = make_token(
        rsa_key, kid, sub=alice, email="alice@example.com", provider="google", name="Alice A."
    )
    bob_token = make_token(
        rsa_key, kid, sub=bob, email="bob@example.com", provider="email", name="Bob B."
    )

    hr("1. Health (no auth)")
    show(client.get("/health"))

    hr("2. GET /v1/users/me with NO token -> 401")
    show(client.get("/v1/users/me"))

    hr("3. GET /v1/users/me with valid token, no profile yet -> 404")
    show(client.get("/v1/users/me", headers={"Authorization": f"Bearer {alice_token}"}))

    hr("4. Alice: PUT /v1/users/me (first time) -> 201 created")
    show(client.put("/v1/users/me", headers={"Authorization": f"Bearer {alice_token}"}))

    hr("5. Alice: PUT /v1/users/me again -> 200 idempotent")
    show(client.put("/v1/users/me", headers={"Authorization": f"Bearer {alice_token}"}))

    hr("6. Alice tries to smuggle a different user_id + email in the body -> ignored")
    show(
        client.put(
            "/v1/users/me",
            headers={"Authorization": f"Bearer {alice_token}"},
            json={"user_id": str(uuid.uuid4()), "email": "attacker@example.com"},
        )
    )

    hr("7. Alice PATCH display_name -> 200")
    show(
        client.patch(
            "/v1/users/me",
            headers={"Authorization": f"Bearer {alice_token}"},
            json={"display_name": "Alice The Runner"},
        )
    )

    hr("8. Bob provisions -> 201, then GET /me returns only Bob's row")
    show(client.put("/v1/users/me", headers={"Authorization": f"Bearer {bob_token}"}))
    show(client.get("/v1/users/me", headers={"Authorization": f"Bearer {bob_token}"}))

    hr("9. Alice GET /me still returns only Alice (with edited display_name)")
    show(client.get("/v1/users/me", headers={"Authorization": f"Bearer {alice_token}"}))

    hr("10. PATCH rejects unknown field")
    show(
        client.patch(
            "/v1/users/me",
            headers={"Authorization": f"Bearer {alice_token}"},
            json={"email": "attacker@example.com"},
        )
    )

    hr("11. Expired token -> 401")
    now = datetime.now(tz=timezone.utc)
    expired_payload = {
        "iss": "https://demo.supabase.co/auth/v1",
        "aud": "authenticated",
        "role": "authenticated",
        "sub": alice,
        "email": "alice@example.com",
        "exp": int((now - timedelta(minutes=1)).timestamp()),
    }
    pem = rsa_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    expired = jwt.encode(expired_payload, pem, algorithm="RS256", headers={"kid": kid})
    show(client.get("/v1/users/me", headers={"Authorization": f"Bearer {expired}"}))

    hr("Done. Only Alice's edited display_name survives; system-owned fields track claims.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
