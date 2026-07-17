"""Tests for the JWT verification dependency (`get_current_user_claims`)."""

from __future__ import annotations

import uuid



def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_missing_header_returns_401(client) -> None:
    r = client.get("/v1/users/me")
    assert r.status_code == 401
    assert r.headers.get("www-authenticate") == "Bearer"


def test_wrong_scheme_returns_401(client, token_factory) -> None:
    token = token_factory()
    r = client.get("/v1/users/me", headers={"Authorization": f"Basic {token}"})
    assert r.status_code == 401


def test_malformed_jwt_returns_401(client) -> None:
    r = client.get("/v1/users/me", headers=_auth("not-a-jwt"))
    assert r.status_code == 401


def test_expired_jwt_returns_401(client, token_factory) -> None:
    token = token_factory(exp_offset=-60)
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_wrong_issuer_returns_401(client, token_factory) -> None:
    token = token_factory(iss="https://evil.example.com/auth/v1")
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_wrong_audience_returns_401(client, token_factory) -> None:
    token = token_factory(aud="not-authenticated")
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_invalid_signature_returns_401(
    client, rsa_key, kid, token_factory, monkeypatch
) -> None:
    from cryptography.hazmat.primitives.asymmetric import rsa

    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    from tests.conftest import make_token

    token = make_token(other_key, kid)  # signed with wrong key
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_unknown_kid_returns_401(client, rsa_key) -> None:
    from tests.conftest import make_token

    token = make_token(rsa_key, "kid-not-in-jwks")
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_missing_sub_returns_401(client, token_factory) -> None:
    token = token_factory(include_sub=False)
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_non_uuid_sub_returns_401(client, token_factory) -> None:
    token = token_factory(sub="not-a-uuid")
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_non_authenticated_role_returns_401(client, token_factory) -> None:
    token = token_factory(role="anon")
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401


def test_valid_token_returns_404_for_missing_profile(client, token_factory) -> None:
    """A valid token whose user has no profile yet should surface 404, not 401."""

    sub = str(uuid.uuid4())
    token = token_factory(sub=sub)
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 404
    body = r.json()
    assert body["detail"]["code"] == "profile_not_provisioned"


def test_disallowed_algorithm_returns_401(client, rsa_key, kid) -> None:
    """A token signed with an algorithm not in the allow-list must be rejected."""

    # HS256 is not in the configured allow-list.
    import jwt as pyjwt

    payload = {
        "sub": str(uuid.uuid4()),
        "iss": "https://test.supabase.co/auth/v1",
        "aud": "authenticated",
        "role": "authenticated",
        "email": "a@b.com",
        "exp": 10_000_000_000,
    }
    token = pyjwt.encode(payload, "shared-secret", algorithm="HS256", headers={"kid": kid})
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 401
