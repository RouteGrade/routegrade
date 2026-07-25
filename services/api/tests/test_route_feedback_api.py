"""Tests for route-view feedback under /v1/users/me/routes/{route_id}/feedback."""

from __future__ import annotations

import uuid

import pytest


def _feedback_payload(**overrides):
    payload = {
        "verdict": "too_generous",
        "tags": ["too_many_crossings", "hillier_than_graded"],
        "comment": "Graded an A but it crosses three busy roads.",
        "graded_score": 88.5,
        "graded_grade": "A",
        "preference": "quiet",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def auth_headers(token_factory):
    def _for(sub: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token_factory(sub=sub)}"}

    return _for


class TestAuthRequired:
    @pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
    def test_missing_token_is_401(self, client, method):
        path = f"/v1/users/me/routes/{uuid.uuid4()}/feedback"
        res = client.request(
            method, path, json=_feedback_payload() if method == "PUT" else None
        )
        assert res.status_code == 401
        assert res.headers.get("WWW-Authenticate") == "Bearer"


class TestSaveAndFetch:
    def test_put_creates_then_updates(self, client, auth_headers):
        user = str(uuid.uuid4())
        route_id = str(uuid.uuid4())

        created = client.put(
            f"/v1/users/me/routes/{route_id}/feedback",
            json=_feedback_payload(),
            headers=auth_headers(user),
        )
        assert created.status_code == 201
        body = created.json()
        assert body["created"] is True
        assert body["feedback"]["route_id"] == route_id
        assert body["feedback"]["verdict"] == "too_generous"
        assert body["feedback"]["tags"] == ["too_many_crossings", "hillier_than_graded"]

        updated = client.put(
            f"/v1/users/me/routes/{route_id}/feedback",
            json=_feedback_payload(verdict="accurate", tags=["distance_off"]),
            headers=auth_headers(user),
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["created"] is False
        assert body["feedback"]["verdict"] == "accurate"
        assert body["feedback"]["tags"] == ["distance_off"]

    def test_get_returns_own_feedback_only(self, client, auth_headers):
        owner = str(uuid.uuid4())
        route_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/routes/{route_id}/feedback",
            json=_feedback_payload(),
            headers=auth_headers(owner),
        )

        ok = client.get(
            f"/v1/users/me/routes/{route_id}/feedback", headers=auth_headers(owner)
        )
        assert ok.status_code == 200
        assert ok.json()["verdict"] == "too_generous"

        stranger = client.get(
            f"/v1/users/me/routes/{route_id}/feedback",
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert stranger.status_code == 404

    def test_two_users_can_rate_the_same_route_id_independently(
        self, client, auth_headers
    ):
        """Feedback is keyed on (user_id, route_id) — no cross-user collision."""
        route_id = str(uuid.uuid4())
        a = str(uuid.uuid4())
        b = str(uuid.uuid4())

        ra = client.put(
            f"/v1/users/me/routes/{route_id}/feedback",
            json=_feedback_payload(verdict="too_harsh"),
            headers=auth_headers(a),
        )
        rb = client.put(
            f"/v1/users/me/routes/{route_id}/feedback",
            json=_feedback_payload(verdict="accurate"),
            headers=auth_headers(b),
        )
        assert ra.status_code == 201
        assert rb.status_code == 201
        assert (
            client.get(
                f"/v1/users/me/routes/{route_id}/feedback", headers=auth_headers(a)
            ).json()["verdict"]
            == "too_harsh"
        )
        assert (
            client.get(
                f"/v1/users/me/routes/{route_id}/feedback", headers=auth_headers(b)
            ).json()["verdict"]
            == "accurate"
        )

    def test_minimal_feedback_is_valid(self, client, auth_headers):
        """A one-tap verdict (no tags/snapshot) must save."""
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json={"verdict": "accurate"},
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 201
        body = res.json()["feedback"]
        assert body["verdict"] == "accurate"
        assert body["tags"] == []
        assert body["comment"] is None
        assert body["graded_grade"] is None


class TestDelete:
    def test_delete_own_feedback(self, client, auth_headers):
        owner = str(uuid.uuid4())
        route_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/routes/{route_id}/feedback",
            json=_feedback_payload(),
            headers=auth_headers(owner),
        )
        res = client.delete(
            f"/v1/users/me/routes/{route_id}/feedback", headers=auth_headers(owner)
        )
        assert res.status_code == 204
        gone = client.get(
            f"/v1/users/me/routes/{route_id}/feedback", headers=auth_headers(owner)
        )
        assert gone.status_code == 404

    def test_delete_missing_is_404(self, client, auth_headers):
        res = client.delete(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 404


class TestValidation:
    def test_verdict_required(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json={"tags": ["distance_off"]},
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_bad_verdict_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json=_feedback_payload(verdict="meh"),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_unknown_tag_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json=_feedback_payload(tags=["distance_off", "definitely-not-a-tag"]),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_duplicate_tags_are_deduped(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json=_feedback_payload(tags=["distance_off", "distance_off", "not_scenic"]),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 201
        assert res.json()["feedback"]["tags"] == ["distance_off", "not_scenic"]

    def test_too_many_tags_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json=_feedback_payload(
                tags=[
                    "too_many_crossings",
                    "too_few_crossings",
                    "hillier_than_graded",
                    "flatter_than_graded",
                    "busier_than_graded",
                    "quieter_than_graded",
                    "surface_worse",
                ]
            ),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_extra_fields_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json=_feedback_payload(sneaky="nope"),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_overlong_comment_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}/feedback",
            json=_feedback_payload(comment="x" * 281),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422
