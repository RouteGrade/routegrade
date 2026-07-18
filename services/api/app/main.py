"""RouteGrade FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.plans import router as plans_router
from app.api.routes.runs import router as runs_router
from app.api.routes.saved_routes import router as saved_routes_router
from app.api.routes.users import router as users_router
from app.core.config import get_settings
from app.db.session import dispose


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="RouteGrade API", lifespan=_lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "routegrade-api"}

    app.include_router(users_router)
    app.include_router(plans_router)
    app.include_router(saved_routes_router)
    app.include_router(runs_router)
    return app


app = create_app()
