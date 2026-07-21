"""ASGI entrypoint. Vercel's FastAPI framework preset and `uvicorn main:app`
both find the FastAPI app at this exact module. Everything else builds it via
`create_app()` (tests, demos) — see `app/main.py` for why `app` lives only
here at module scope."""

from app.main import create_app

app = create_app()

__all__ = ["app"]
