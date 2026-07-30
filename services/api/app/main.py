"""RouteGrade FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.plans import router as plans_router
from app.api.routes.runs import router as runs_router
from app.api.routes.saved_routes import router as saved_routes_router
from app.api.routes.users import router as users_router
from app.core.body_limit import BodySizeLimitMiddleware
from app.core.config import get_settings
from app.db.session import dispose


logger = logging.getLogger(__name__)

# Hosts known to serve a single (driving) graph regardless of the profile in the
# request path. Asking them for `foot` returns car routing with no error.
_PROFILE_IGNORING_HOSTS = ("router.project-osrm.org",)


def warn_if_profile_is_a_no_op(base_url: str, profile: str) -> str | None:
    """Warning text when OSRM_PROFILE cannot possibly be honoured, else None.

    The public demo server returns byte-identical routes for `foot`, `driving`,
    `bicycle` and even a profile that does not exist — measured 2026-07-29, all
    four gave 1279.1 m / 150.7 s for the same pair, which is ~30 km/h and
    therefore a car. Configuring `foot` against it is a silent no-op, and it is
    why route grades cluster: intersection density is derived from routing
    manoeuvres per km, and a car router collapses onto arterials regardless of
    the real street grid.

    Silent misconfiguration that corrupts the product's core output is worth a
    loud line in the logs, so this says so at startup rather than leaving it to
    be rediscovered from the symptoms.
    """
    if profile.lower() == "driving":
        return None
    if not any(host in base_url for host in _PROFILE_IGNORING_HOSTS):
        return None
    return (
        f"OSRM_PROFILE={profile!r} has no effect against {base_url} — that host "
        "serves the driving graph for every profile. Route grades computed from "
        "it reflect car routing. Self-host a foot graph (see deploy/osrm/ and "
        "docs/OSRM_CUTOVER_RUNBOOK.md) before trusting grades."
    )


@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="RouteGrade API", lifespan=_lifespan)

    if warning := warn_if_profile_is_a_no_op(
        settings.osrm_base_url, settings.osrm_profile
    ):
        logger.warning(warning)

    # Added before CORS so CORS ends up outermost and its headers are still
    # attached to a 413 rejection (middleware wraps in reverse add order).
    app.add_middleware(
        BodySizeLimitMiddleware,
        max_bytes=settings.max_request_body_bytes,
    )

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


# NOTE: no module-level `app = create_app()` here. Only `services/api/main.py`
# exports a module-level `app` for the ASGI server (Vercel + uvicorn). Having
# `app` here as well confuses Vercel's FastAPI framework preset, which picks
# an entrypoint by scanning for `app` at module scope and refuses when it
# finds more than one candidate.
