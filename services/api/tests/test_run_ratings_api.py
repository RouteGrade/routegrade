"""Tests for post-run ratings under /v1/users/me/runs/{run_id}/rating."""

from __future__ import annotations

import uuid

import pytest


def _rating_payload(**overrides):
    payload = {
        "overall": 4,
        "grade_match": "as_expected",
        "tags": ["flat", "quiet", "well_lit"],
        "comment": "Smooth and quiet the whole way.",
        "route_id": str(uuid.uuid4()),
        "graded_score": 88.5,
        "graded_grade": "A",
        "preference": "flat",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def auth_headers(token_factory):
    def _for(sub: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token_factory(sub=sub)}"}

    return _for


class TestAuthRequired:
    @pytest.mark.parametrize(
        "method",
        ["GET", "PUT", "DELETE"],
    )
    def test_missing_token_is_401(self, client, method):
        path = f"/v1/users/me/runs/{uuid.uuid4()}/rating"
        res = client.request(
            method, path, json=_rating_payload() if method == "PUT" else None
        )
        assert res.status_code == 401
        assert res.headers.get("WWW-Authenticate") == "Bearer"


class TestSaveAndFetch:
    def test_put_creates_then_updates(self, client, auth_headers):
        user = str(uuid.uuid4())
        run_id = str(uuid.uuid4())

        created = client.put(
            f"/v1/users/me/runs/{run_id}/rating",
            json=_rating_payload(),
            headers=auth_headers(user),
        )
        assert created.status_code == 201
        body = created.json()
        assert body["created"] is True
        assert body["rating"]["run_id"] == run_id
        assert body["rating"]["overall"] == 4
        assert body["rating"]["tags"] == ["flat", "quiet", "well_lit"]

        updated = client.put(
            f"/v1/users/me/runs/{run_id}/rating",
            json=_rating_payload(overall=2, grade_match="felt_worse", tags=["hilly"]),
            headers=auth_headers(user),
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["created"] is False
        assert body["rating"]["overall"] == 2
        assert body["rating"]["grade_match"] == "felt_worse"
        assert body["rating"]["tags"] == ["hilly"]

    def test_get_returns_own_rating_only(self, client, auth_headers):
        owner = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/runs/{run_id}/rating",
            json=_rating_payload(),
            headers=auth_headers(owner),
        )

        ok = client.get(
            f"/v1/users/me/runs/{run_id}/rating", headers=auth_headers(owner)
        )
        assert ok.status_code == 200
        assert ok.json()["overall"] == 4

        stranger = client.get(
            f"/v1/users/me/runs/{run_id}/rating",
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert stranger.status_code == 404

    def test_two_users_can_rate_the_same_run_id_independently(
        self, client, auth_headers
    ):
        """Ratings are keyed on (user_id, run_id) — no cross-user collision."""
        run_id = str(uuid.uuid4())
        a = str(uuid.uuid4())
        b = str(uuid.uuid4())

        ra = client.put(
            f"/v1/users/me/runs/{run_id}/rating",
            json=_rating_payload(overall=5),
            headers=auth_headers(a),
        )
        rb = client.put(
            f"/v1/users/me/runs/{run_id}/rating",
            json=_rating_payload(overall=1),
            headers=auth_headers(b),
        )
        assert ra.status_code == 201
        assert rb.status_code == 201
        assert (
            client.get(
                f"/v1/users/me/runs/{run_id}/rating", headers=auth_headers(a)
            ).json()["overall"]
            == 5
        )
        assert (
            client.get(
                f"/v1/users/me/runs/{run_id}/rating", headers=auth_headers(b)
            ).json()["overall"]
            == 1
        )

    def test_minimal_rating_is_valid(self, client, auth_headers):
        """A one-tap rating (just stars) must save."""
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            json={"overall": 3},
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 201
        body = res.json()["rating"]
        assert body["overall"] == 3
        assert body["tags"] == []
        assert body["grade_match"] is None
        assert body["route_id"] is None


class TestDelete:
    def test_delete_own_rating(self, client, auth_headers):
        owner = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/runs/{run_id}/rating",
            json=_rating_payload(),
            headers=auth_headers(owner),
        )
        res = client.delete(
            f"/v1/users/me/runs/{run_id}/rating", headers=auth_headers(owner)
        )
        assert res.status_code == 204
        gone = client.get(
            f"/v1/users/me/runs/{run_id}/rating", headers=auth_headers(owner)
        )
        assert gone.status_code == 404

    def test_delete_missing_is_404(self, client, auth_headers):
        res = client.delete(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 404


class TestValidation:
    def test_overall_out_of_range_rejected(self, client, auth_headers):
        for bad in (0, 6):
            res = client.put(
                f"/v1/users/me/runs/{uuid.uuid4()}/rating",
                json=_rating_payload(overall=bad),
                headers=auth_headers(str(uuid.uuid4())),
            )
            assert res.status_code == 422

    def test_unknown_tag_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            json=_rating_payload(tags=["flat", "definitely-not-a-tag"]),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_duplicate_tags_are_deduped(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            json=_rating_payload(tags=["flat", "flat", "quiet"]),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 201
        assert res.json()["rating"]["tags"] == ["flat", "quiet"]

    def test_bad_grade_match_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            json=_rating_payload(grade_match="meh"),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_extra_fields_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            json=_rating_payload(sneaky="nope"),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_overlong_comment_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}/rating",
            json=_rating_payload(comment="x" * 281),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422
