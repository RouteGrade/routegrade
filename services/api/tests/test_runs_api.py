"""Tests for the authenticated run-history CRUD under /v1/users/me/runs."""

from __future__ import annotations

import uuid

import pytest


def _run_payload(**overrides):
    payload = {
        "route_id": str(uuid.uuid4()),
        "route_name": "North loop · 5.1 km",
        "started_at": "2026-07-18T12:00:00Z",
        "duration_s": 1810,
        "distance_km": 5.12,
        "avg_pace_s_per_km": 354,
        "splits": [
            {"km": 1, "duration_s": 350},
            {"km": 2, "duration_s": 348},
            {"km": 3, "duration_s": 361},
            {"km": 4, "duration_s": 352},
            {"km": 5, "duration_s": 356},
        ],
        "path": {
            "type": "LineString",
            "coordinates": [
                [-79.3832, 43.6519],
                [-79.3849, 43.6515],
                [-79.3871, 43.6510],
                [-79.3832, 43.6519],
            ],
        },
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
        "method,path",
        [
            ("GET", "/v1/users/me/runs"),
            ("GET", f"/v1/users/me/runs/{uuid.uuid4()}"),
            ("PUT", f"/v1/users/me/runs/{uuid.uuid4()}"),
            ("DELETE", f"/v1/users/me/runs/{uuid.uuid4()}"),
        ],
    )
    def test_missing_token_is_401_with_www_authenticate(self, client, method, path):
        res = client.request(method, path, json=_run_payload() if method == "PUT" else None)
        assert res.status_code == 401
        assert res.headers.get("WWW-Authenticate") == "Bearer"


class TestSaveAndList:
    def test_put_creates_then_replaces(self, client, auth_headers):
        user = str(uuid.uuid4())
        run_id = str(uuid.uuid4())

        created = client.put(
            f"/v1/users/me/runs/{run_id}", json=_run_payload(), headers=auth_headers(user)
        )
        assert created.status_code == 201
        body = created.json()
        assert body["created"] is True
        assert body["run"]["id"] == run_id
        assert body["run"]["duration_s"] == 1810
        assert len(body["run"]["splits"]) == 5

        replaced = client.put(
            f"/v1/users/me/runs/{run_id}",
            json=_run_payload(duration_s=1900, distance_km=5.3),
            headers=auth_headers(user),
        )
        assert replaced.status_code == 200
        body = replaced.json()
        assert body["created"] is False
        assert body["run"]["duration_s"] == 1900

    def test_list_is_owner_scoped_and_newest_first(self, client, auth_headers):
        runner = str(uuid.uuid4())
        other = str(uuid.uuid4())

        first = str(uuid.uuid4())
        second = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/runs/{first}",
            json=_run_payload(started_at="2026-07-17T08:00:00Z"),
            headers=auth_headers(runner),
        )
        client.put(
            f"/v1/users/me/runs/{second}",
            json=_run_payload(started_at="2026-07-18T08:00:00Z"),
            headers=auth_headers(runner),
        )
        client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}",
            json=_run_payload(),
            headers=auth_headers(other),
        )

        res = client.get("/v1/users/me/runs", headers=auth_headers(runner))
        assert res.status_code == 200
        runs = res.json()["runs"]
        assert [r["id"] for r in runs] == [second, first]

    def test_run_without_route_or_path_is_valid(self, client, auth_headers):
        """Free runs (no planned route, GPS denied) must still save."""
        user = str(uuid.uuid4())
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}",
            json=_run_payload(route_id=None, route_name=None, path=None, splits=[]),
            headers=auth_headers(user),
        )
        assert res.status_code == 201
        body = res.json()["run"]
        assert body["route_id"] is None
        assert body["path"] is None

    def test_id_owned_by_other_user_is_409(self, client, auth_headers):
        run_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/runs/{run_id}",
            json=_run_payload(),
            headers=auth_headers(str(uuid.uuid4())),
        )
        res = client.put(
            f"/v1/users/me/runs/{run_id}",
            json=_run_payload(),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "run_id_conflict"


class TestGetAndDelete:
    def test_get_returns_own_run_only(self, client, auth_headers):
        owner = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/runs/{run_id}", json=_run_payload(), headers=auth_headers(owner)
        )

        ok = client.get(f"/v1/users/me/runs/{run_id}", headers=auth_headers(owner))
        assert ok.status_code == 200
        assert ok.json()["id"] == run_id

        stranger = client.get(
            f"/v1/users/me/runs/{run_id}", headers=auth_headers(str(uuid.uuid4()))
        )
        assert stranger.status_code == 404

    def test_delete_own_run(self, client, auth_headers):
        owner = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        client.put(
            f"/v1/users/me/runs/{run_id}", json=_run_payload(), headers=auth_headers(owner)
        )

        res = client.delete(f"/v1/users/me/runs/{run_id}", headers=auth_headers(owner))
        assert res.status_code == 204

        gone = client.get(f"/v1/users/me/runs/{run_id}", headers=auth_headers(owner))
        assert gone.status_code == 404

    def test_delete_missing_is_404(self, client, auth_headers):
        res = client.delete(
            f"/v1/users/me/runs/{uuid.uuid4()}", headers=auth_headers(str(uuid.uuid4()))
        )
        assert res.status_code == 404


class TestValidation:
    def test_zero_duration_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}",
            json=_run_payload(duration_s=0),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422

    def test_extra_fields_rejected(self, client, auth_headers):
        res = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}",
            json=_run_payload(hacker_field="nope"),
            headers=auth_headers(str(uuid.uuid4())),
        )
        assert res.status_code == 422
