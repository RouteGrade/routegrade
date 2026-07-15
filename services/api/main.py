"""RouteGrade API — walking skeleton."""

from fastapi import FastAPI

app = FastAPI(title="RouteGrade API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "routegrade-api"}
