"""Tests for the authenticated saved-routes CRUD under /v1/users/me/routes."""

from __future__ import annotations

import uuid

import pytest


def _route_payload(**overrides):
    payload = {
        "name": "North loop · 5.1 km",
        "starting_address": "Nathan Phillips Square, Toronto",
        "distance_km": 5.1,
        "preference": "quiet",
        "geometry": {
            "type": "LineString",
            "coordinates": [
                [-79.3832, 43.6519],
                [-79.3849, 43.6515],
                [-79.3871, 43.6510],
                [-79.3832, 43.6519],
            ],
        },
        "elevation_gain_m": 42.0,
        "score": 87.5,
        "grade": "A",
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
            ("GET", "/v1/users/me/routes"),
            ("GET", f"/v1/users/me/routes/{uuid.uuid4()}"),
            ("PUT", f"/v1/users/me/routes/{uuid.uuid4()}"),
            ("DELETE", f"/v1/users/me/routes/{uuid.uuid4()}"),
        ],
    )
    def test_missing_token_is_401_with_www_authenticate(self, client, method, path):
        res = client.request(method, path, json=_route_payload() if method == "PUT" else None)
        assert res.status_code == 401
        assert res.headers.get("WWW-Authenticate") == "Bearer"


class TestSaveAndList:
    def test_put_creates_then_replaces(self, client, auth_headers):
        user = str(uuid.uuid4())
        route_id = str(uuid.uuid4())

        created = client.put(
            f"/v1/users/me/routes/{route_id}", json=_route_payload(), headers=auth_headers(user)
        )
        assert created.status_code == 201
        body = created.json()
        assert body["created"] is True
        assert body["route"]["id"] == route_id
        assert body["route"]["grade"] == "A"

        replaced = client.put(
            f"/v1/users/me/routes/{route_id}",
            json=_route_payload(name="Renamed loop", grade="B", score=72.0),
            headers=auth_headers(user),
        )
        assert replaced.status_code == 200
        body = replaced.json()
        assert body["created"] is False
        assert body["route"]["name"] == "Renamed loop"
        assert body["route"]["grade"] == "B"

    def test_list_returns_only_own_routes(self, client, auth_headers):
        user_a, user_b = str(uuid.uuid4()), str(uuid.uuid4())
        a_route, b_route = str(uuid.uuid4()), str(uuid.uuid4())

        client.put(f"/v1/users/me/routes/{a_route}", json=_route_payload(), headers=auth_headers(user_a))
        client.put(
            f"/v1/users/me/routes/{b_route}",
            json=_route_payload(name="B's route"),
            headers=auth_headers(user_b),
        )

        listing = client.get("/v1/users/me/routes", headers=auth_headers(user_a)).json()
        ids = [r["id"] for r in listing["routes"]]
        assert ids == [a_route]

    def test_get_by_id_and_cross_user_404(self, client, auth_headers):
        user_a, user_b = str(uuid.uuid4()), str(uuid.uuid4())
        route_id = str(uuid.uuid4())
        client.put(f"/v1/users/me/routes/{route_id}", json=_route_payload(), headers=auth_headers(user_a))

        own = client.get(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user_a))
        assert own.status_code == 200
        assert own.json()["geometry"]["type"] == "LineString"

        other = client.get(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user_b))
        assert other.status_code == 404

    def test_put_on_route_id_owned_by_other_user_is_409(self, client, auth_headers):
        user_a, user_b = str(uuid.uuid4()), str(uuid.uuid4())
        route_id = str(uuid.uuid4())
        client.put(f"/v1/users/me/routes/{route_id}", json=_route_payload(), headers=auth_headers(user_a))

        res = client.put(
            f"/v1/users/me/routes/{route_id}",
            json=_route_payload(name="hijack attempt"),
            headers=auth_headers(user_b),
        )
        assert res.status_code == 409

        # A's route is untouched.
        mine = client.get(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user_a))
        assert mine.json()["name"] == "North loop · 5.1 km"


class TestDelete:
    def test_delete_then_404(self, client, auth_headers):
        user = str(uuid.uuid4())
        route_id = str(uuid.uuid4())
        client.put(f"/v1/users/me/routes/{route_id}", json=_route_payload(), headers=auth_headers(user))

        assert (
            client.delete(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user)).status_code
            == 204
        )
        assert (
            client.get(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user)).status_code
            == 404
        )
        assert (
            client.delete(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user)).status_code
            == 404
        )

    def test_cannot_delete_other_users_route(self, client, auth_headers):
        user_a, user_b = str(uuid.uuid4()), str(uuid.uuid4())
        route_id = str(uuid.uuid4())
        client.put(f"/v1/users/me/routes/{route_id}", json=_route_payload(), headers=auth_headers(user_a))

        res = client.delete(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user_b))
        assert res.status_code == 404
        assert (
            client.get(f"/v1/users/me/routes/{route_id}", headers=auth_headers(user_a)).status_code
            == 200
        )


class TestValidation:
    def test_rejects_bad_grade_and_geometry(self, client, auth_headers):
        headers = auth_headers(str(uuid.uuid4()))
        route_id = str(uuid.uuid4())

        assert (
            client.put(
                f"/v1/users/me/routes/{route_id}",
                json=_route_payload(grade="F"),
                headers=headers,
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/v1/users/me/routes/{route_id}",
                json=_route_payload(geometry={"type": "Point", "coordinates": [0, 0]}),
                headers=headers,
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/v1/users/me/routes/{route_id}",
                json=_route_payload(name="   "),
                headers=headers,
            ).status_code
            == 422
        )
