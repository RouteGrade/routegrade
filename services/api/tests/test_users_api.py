"""Tests for `/v1/users/me` PUT / GET / PATCH."""

from __future__ import annotations

import uuid


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_put_me_creates_profile(client, token_factory) -> None:
    sub = str(uuid.uuid4())
    token = token_factory(
        sub=sub,
        email="new@example.com",
        user_metadata={"full_name": "New User", "avatar_url": "https://cdn/x.png"},
        app_metadata={"provider": "google"},
    )
    r = client.put("/v1/users/me", headers=_auth(token))
    assert r.status_code == 201
    body = r.json()
    assert body["created"] is True
    assert body["user"]["user_id"] == sub
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["display_name"] == "New User"
    assert body["user"]["avatar_url"] == "https://cdn/x.png"
    assert body["user"]["auth_provider"] == "google"


def test_put_me_is_idempotent(client, token_factory) -> None:
    sub = str(uuid.uuid4())
    token = token_factory(sub=sub, email="idem@example.com")

    r1 = client.put("/v1/users/me", headers=_auth(token))
    assert r1.status_code == 201
    r2 = client.put("/v1/users/me", headers=_auth(token))
    assert r2.status_code == 200
    assert r2.json()["created"] is False


def test_put_me_syncs_system_fields_but_not_display_name(client, token_factory) -> None:
    sub = str(uuid.uuid4())
    first = token_factory(
        sub=sub,
        email="first@example.com",
        user_metadata={"full_name": "First Name"},
        app_metadata={"provider": "email"},
    )
    client.put("/v1/users/me", headers=_auth(first)).raise_for_status()

    # User edits their display_name.
    client.patch("/v1/users/me", headers=_auth(first), json={"display_name": "Custom"}).raise_for_status()

    # A later login carries updated verified metadata; display_name must not regress.
    second = token_factory(
        sub=sub,
        email="second@example.com",
        user_metadata={"full_name": "Different Name", "avatar_url": "https://cdn/y.png"},
        app_metadata={"provider": "google"},
    )
    r = client.put("/v1/users/me", headers=_auth(second))
    assert r.status_code == 200
    body = r.json()["user"]
    assert body["email"] == "second@example.com"
    assert body["auth_provider"] == "google"
    assert body["avatar_url"] == "https://cdn/y.png"
    assert body["display_name"] == "Custom"


def test_get_me_returns_only_authenticated_user(client, token_factory) -> None:
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())

    token_a = token_factory(sub=user_a, email="a@example.com")
    token_b = token_factory(sub=user_b, email="b@example.com")

    client.put("/v1/users/me", headers=_auth(token_a)).raise_for_status()
    client.put("/v1/users/me", headers=_auth(token_b)).raise_for_status()

    r = client.get("/v1/users/me", headers=_auth(token_a))
    assert r.status_code == 200
    assert r.json()["user_id"] == user_a
    assert r.json()["email"] == "a@example.com"


def test_get_me_returns_404_when_not_provisioned(client, token_factory) -> None:
    token = token_factory()
    r = client.get("/v1/users/me", headers=_auth(token))
    assert r.status_code == 404


def test_patch_me_updates_display_name(client, token_factory) -> None:
    token = token_factory()
    client.put("/v1/users/me", headers=_auth(token)).raise_for_status()

    r = client.patch(
        "/v1/users/me",
        headers=_auth(token),
        json={"display_name": "Nitpreet"},
    )
    assert r.status_code == 200
    assert r.json()["display_name"] == "Nitpreet"


def test_patch_me_rejects_unknown_fields(client, token_factory) -> None:
    token = token_factory()
    client.put("/v1/users/me", headers=_auth(token)).raise_for_status()

    r = client.patch(
        "/v1/users/me",
        headers=_auth(token),
        json={"email": "attacker@example.com"},
    )
    assert r.status_code == 422


def test_patch_me_rejects_blank_display_name(client, token_factory) -> None:
    token = token_factory()
    client.put("/v1/users/me", headers=_auth(token)).raise_for_status()

    r = client.patch(
        "/v1/users/me",
        headers=_auth(token),
        json={"display_name": "   "},
    )
    assert r.status_code == 422


def test_patch_me_rejects_too_long_display_name(client, token_factory) -> None:
    token = token_factory()
    client.put("/v1/users/me", headers=_auth(token)).raise_for_status()

    r = client.patch(
        "/v1/users/me",
        headers=_auth(token),
        json={"display_name": "x" * 200},
    )
    assert r.status_code == 422


def test_patch_me_returns_404_when_not_provisioned(client, token_factory) -> None:
    token = token_factory()
    r = client.patch("/v1/users/me", headers=_auth(token), json={"display_name": "x"})
    assert r.status_code == 404


def test_user_a_cannot_read_user_b(client, token_factory) -> None:
    user_a = str(uuid.uuid4())
    user_b = str(uuid.uuid4())

    token_a = token_factory(sub=user_a, email="a@example.com")
    token_b = token_factory(sub=user_b, email="b@example.com")
    client.put("/v1/users/me", headers=_auth(token_b)).raise_for_status()

    # User A hitting /me should never see user B's row — even if user B exists.
    r = client.get("/v1/users/me", headers=_auth(token_a))
    assert r.status_code == 404


def test_client_cannot_override_user_id_or_email_on_put(client, token_factory) -> None:
    real_sub = str(uuid.uuid4())
    token = token_factory(sub=real_sub, email="real@example.com")

    # Attempt to smuggle a different user_id / email in the body.
    r = client.put(
        "/v1/users/me",
        headers=_auth(token),
        json={
            "user_id": str(uuid.uuid4()),
            "email": "attacker@example.com",
        },
    )
    assert r.status_code == 201  # body is ignored
    body = r.json()["user"]
    assert body["user_id"] == real_sub
    assert body["email"] == "real@example.com"
