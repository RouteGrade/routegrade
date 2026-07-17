"""Uvicorn entry point: re-exports the FastAPI application from `app.main`."""

from app.main import app

__all__ = ["app"]
