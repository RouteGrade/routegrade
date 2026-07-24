"""Request body-size limit middleware.

Defense-in-depth: the route schemas already bound array lengths (e.g. a drawn
trace is capped at 5000 points), but Starlette/FastAPI buffers the whole body
into memory *before* validation runs, so an attacker could force large
allocations with a payload that Pydantic would ultimately reject anyway. This
middleware caps the body up front and answers 413 without parsing it.

It checks the declared ``Content-Length`` for a fast reject, and — because that
header can be absent (chunked transfer) or simply lie — also counts the bytes
it actually reads, tripping the same 413 the moment the real body exceeds the
limit. Only methods that carry a body are buffered; GET/HEAD/etc. pass straight
through untouched.
"""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_TOO_LARGE_BODY = (
    b'{"detail":{"code":"payload_too_large",'
    b'"message":"Request body exceeds the maximum allowed size."}}'
)


class BodySizeLimitMiddleware:
    """Reject requests whose body exceeds ``max_bytes`` with 413 Payload Too Large."""

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # A max of 0 disables the limit; non-HTTP scopes (lifespan, websocket)
        # have no request body to guard.
        if self.max_bytes <= 0 or scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Fast path: a declared Content-Length over the cap needs no buffering.
        for name, value in scope.get("headers", ()):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    await self._reject(send)
                    return
                break

        if scope.get("method", "GET").upper() not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return

        # Buffer the body, counting bytes, so a missing/lying Content-Length is
        # still caught. Capped at max_bytes, so this never holds more than the
        # limit in memory before rejecting.
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] != "http.request":
                # e.g. http.disconnect — hand it back and let the app unwind.
                await self.app(scope, _replay(bytes(body), message), send)
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                await self._reject(send)
                return
            if not message.get("more_body", False):
                break

        await self.app(scope, _replay(bytes(body)), send)

    async def _reject(self, send: Send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(_TOO_LARGE_BODY)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": _TOO_LARGE_BODY})


def _replay(body: bytes, trailing: Message | None = None) -> Receive:
    """Return a ``receive`` that replays the already-buffered body to the app.

    The full body was consumed to measure it, so downstream handlers get it back
    as a single ``http.request`` message, followed by ``trailing`` (a disconnect)
    or an empty terminal chunk.
    """

    sent_body = False
    sent_trailing = False

    async def receive() -> Message:
        nonlocal sent_body, sent_trailing
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}
        if trailing is not None and not sent_trailing:
            sent_trailing = True
            return trailing
        return {"type": "http.request", "body": b"", "more_body": False}

    return receive
