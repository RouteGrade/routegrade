"""Tests for the request body-size limit middleware.

Two levels: direct ASGI-level unit tests that drive the middleware with crafted
receive streams (the only way to exercise a missing/lying Content-Length and the
byte-counting path), plus integration tests that confirm the 413 is wired into
the real FastAPI app and that normal bodies still flow through to the handler.
"""

from __future__ import annotations

import asyncio

from app.core.body_limit import BodySizeLimitMiddleware


class _RecordingApp:
    """A minimal ASGI app that reads the full body and echoes it back."""

    def __init__(self) -> None:
        self.called = False
        self.received = b""

    async def __call__(self, scope, receive, send) -> None:
        self.called = True
        body = b""
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            body += message.get("body", b"")
            if not message.get("more_body", False):
                break
        self.received = body
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})


def _http_scope(method: str = "POST", headers=None) -> dict:
    return {"type": "http", "method": method, "path": "/", "headers": headers or []}


def _drive(middleware, scope, messages) -> list[dict]:
    """Run the middleware once with a canned receive stream; return sent messages."""

    stream = iter(messages)

    async def receive():
        try:
            return next(stream)
        except StopIteration:
            return {"type": "http.request", "body": b"", "more_body": False}

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope, receive, send))
    return sent


def test_streamed_body_under_limit_passes_through():
    app = _RecordingApp()
    mw = BodySizeLimitMiddleware(app, max_bytes=100)
    sent = _drive(
        mw,
        _http_scope(),
        [
            {"type": "http.request", "body": b"a" * 30, "more_body": True},
            {"type": "http.request", "body": b"b" * 30, "more_body": False},
        ],
    )
    assert app.called is True
    assert app.received == b"a" * 30 + b"b" * 30  # replayed intact
    assert sent[0]["status"] == 200


def test_streamed_body_over_limit_is_rejected_without_content_length():
    # No Content-Length header: the byte-counting path must still trip the 413.
    app = _RecordingApp()
    mw = BodySizeLimitMiddleware(app, max_bytes=50)
    sent = _drive(
        mw,
        _http_scope(),
        [
            {"type": "http.request", "body": b"x" * 40, "more_body": True},
            {"type": "http.request", "body": b"x" * 40, "more_body": False},
        ],
    )
    assert app.called is False  # rejected before the app ran
    assert sent[0]["status"] == 413
    assert b"payload_too_large" in sent[1]["body"]


def test_declared_content_length_over_limit_is_rejected_up_front():
    app = _RecordingApp()
    mw = BodySizeLimitMiddleware(app, max_bytes=50)
    sent = _drive(
        mw,
        _http_scope(headers=[(b"content-length", b"999")]),
        [{"type": "http.request", "body": b"x" * 10, "more_body": False}],
    )
    assert app.called is False
    assert sent[0]["status"] == 413


def test_get_request_passes_through_untouched():
    app = _RecordingApp()
    mw = BodySizeLimitMiddleware(app, max_bytes=50)
    sent = _drive(mw, _http_scope(method="GET"), [])
    assert app.called is True
    assert sent[0]["status"] == 200


def test_zero_limit_disables_the_check():
    app = _RecordingApp()
    mw = BodySizeLimitMiddleware(app, max_bytes=0)
    big = b"x" * 10_000
    sent = _drive(
        mw,
        _http_scope(),
        [{"type": "http.request", "body": big, "more_body": False}],
    )
    assert app.called is True
    assert app.received == big
    assert sent[0]["status"] == 200


def test_malformed_content_length_falls_back_to_counting():
    # A non-numeric Content-Length must not crash; the streamed cap still applies.
    app = _RecordingApp()
    mw = BodySizeLimitMiddleware(app, max_bytes=50)
    sent = _drive(
        mw,
        _http_scope(headers=[(b"content-length", b"not-a-number")]),
        [{"type": "http.request", "body": b"x" * 80, "more_body": False}],
    )
    assert app.called is False
    assert sent[0]["status"] == 413


# --- Integration: the middleware is wired into the real FastAPI app ---


def test_oversized_request_is_rejected_by_the_app(client):
    # Default limit is 1 MiB; a ~1 MiB+ payload is refused before any handler.
    oversized = b"x" * (1_048_576 + 64)
    res = client.post(
        "/v1/routes/custom",
        content=oversized,
        headers={"content-type": "application/json"},
    )
    assert res.status_code == 413
    assert res.json()["detail"]["code"] == "payload_too_large"


def test_normal_body_reaches_validation(client):
    # A small body flows through the middleware and is parsed by the handler,
    # which rejects a single-point trace with 422 — proving pass-through, not 413.
    res = client.post("/v1/routes/custom", json={"coordinates": [[-79.38, 43.65]]})
    assert res.status_code == 422
