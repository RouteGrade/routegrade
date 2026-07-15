# RouteGrade

RouteGrade is a quality and safety layer for running routes. It will eventually score
streets and trails using factors such as traffic, lighting, sidewalk continuity,
elevation, scenery, surface, intersections, and reported safety.

This repository currently contains the **Milestone 1 walking skeleton**: a Next.js
frontend with a MapLibre map of downtown Toronto, a route-preferences form that reveals
a hard-coded sample route, and a FastAPI backend wired up through a health check.

## Repository structure

```text
routegrade/
├── apps/
│   └── web/          # Next.js (App Router, TypeScript, Tailwind CSS, MapLibre GL JS)
├── services/
│   └── api/          # FastAPI service managed with uv
├── db/               # (future) database schema and migrations
├── pipelines/        # (future) data pipelines
├── docs/             # (future) documentation
└── milestones/       # (future) milestone specs
```

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io)
- [uv](https://docs.astral.sh/uv/) (manages its own Python 3.12+)

## Running locally

### Terminal 1 — backend

```bash
cd services/api
uv run uvicorn main:app --reload
```

The API listens on `http://127.0.0.1:8000`. Health endpoint: `http://127.0.0.1:8000/health`.

### Terminal 2 — frontend

```bash
cd apps/web
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The frontend proxies the backend health check through
`http://localhost:3000/api/health`.

## Environment variables

Frontend configuration lives in `apps/web/.env.local` (copy from `.env.example`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `API_URL` | FastAPI base URL used by the Next.js health proxy | `http://127.0.0.1:8000` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre style URL | OpenFreeMap dark style |

## Tests, lint, and build

### Backend

```bash
cd services/api
uv run pytest
uv run ruff check .
```

### Frontend

```bash
cd apps/web
pnpm lint
pnpm build
```

## Tile-provider warning

The default map style (OpenFreeMap) and the MapLibre demo style are fine for **local
development only**. They are not the production tile-provider decision. Before beta,
RouteGrade must adopt a suitable hosted MapLibre-compatible provider and follow its
attribution and usage requirements. Do not configure public OpenStreetMap tile servers
as the production provider.
