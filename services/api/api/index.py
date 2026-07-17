"""Vercel serverless entrypoint.

Vercel's Python runtime serves any ASGI callable named `app`. All requests are
rewritten here (see vercel.json); FastAPI handles routing internally.
"""

from app.main import app

__all__ = ["app"]
