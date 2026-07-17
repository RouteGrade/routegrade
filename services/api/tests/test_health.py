"""Preserved MS1 health endpoint smoke test."""

from __future__ import annotations


def test_health_returns_ok(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "routegrade-api"}
