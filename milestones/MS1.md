# RouteGrade Milestone 1: Walking Skeleton

## Your role

Act as a senior full-stack engineer helping build the first RouteGrade MVP milestone.

Your goal is to create the smallest working application that connects every major layer:

1. A responsive browser interface
2. A Next.js frontend
3. A FastAPI backend
4. A MapLibre map
5. A frontend-to-backend health check

Keep the implementation simple, readable, and easy for a solo developer to extend. Do not add infrastructure or abstractions that are not needed for this milestone.

## Product context

RouteGrade is a quality and safety layer for running routes. It will eventually score streets and trails using factors such as traffic, lighting, sidewalk continuity, elevation, scenery, surface, intersections, and reported safety.

For this milestone, the route can be fake. The important outcome is proving that the full application structure works.

## Definition of the walking skeleton

A user must be able to:

1. Open RouteGrade in a browser.
2. See a map centered on downtown Toronto.
3. Enter basic route preferences.
4. Click **Find routes**.
5. See a hard-coded route appear on the map.
6. See whether the frontend is connected to the backend.

No real address search, route generation, database, authentication, or scoring is required yet.

## Required technology

### Frontend

- Next.js App Router
- TypeScript
- Tailwind CSS
- pnpm
- MapLibre GL JS

### Backend

- Python 3.12+
- uv
- FastAPI
- Uvicorn
- pytest
- Ruff

The backend environment should also include these future-facing dependencies:

- httpx
- pydantic-settings
- SQLAlchemy
- psycopg binary package
- GeoAlchemy2
- Shapely

## Expected repository structure

```text
routegrade/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/health/route.ts
│       │   │   ├── globals.css
│       │   │   ├── layout.tsx
│       │   │   └── page.tsx
│       │   ├── components/
│       │   │   ├── route-explorer.tsx
│       │   │   └── route-map.tsx
│       │   └── fixtures/
│       │       └── sample-route.json
│       ├── .env.example
│       └── package.json
├── services/
│   └── api/
│       ├── main.py
│       ├── test_main.py
│       ├── pyproject.toml
│       └── uv.lock
├── .gitignore
└── README.md
```

You may adjust filenames if necessary, but preserve the separation between the web application and API service.

## Implementation plan

### Step 1: Inspect the repository

Before changing anything:

1. Run `git status -sb`.
2. Inspect the existing files and current branch.
3. Preserve existing work unless it directly conflicts with this milestone.
4. Do not delete or overwrite unrelated changes.

### Step 2: Create or verify the frontend

The frontend should exist at `apps/web` and use Next.js, TypeScript, Tailwind CSS, ESLint, the App Router, and the `src` directory layout.

Install MapLibre:

```bash
cd apps/web
pnpm add maplibre-gl
```

Add `@types/geojson` as a development dependency if it is needed for fixture typing.

### Step 3: Create or verify the backend

The backend should exist at `services/api` and be managed by uv.

Required runtime dependencies:

```bash
uv add fastapi "uvicorn[standard]" httpx pydantic-settings
uv add sqlalchemy "psycopg[binary]" geoalchemy2 shapely
```

Required development dependencies:

```bash
uv add --dev pytest pytest-asyncio ruff
```

Do not rely on a globally installed Python package environment.

### Step 4: Add the API health endpoint

Create this endpoint:

```http
GET /health
```

It must return HTTP 200 with exactly:

```json
{
  "status": "ok",
  "service": "routegrade-api"
}
```

Add an automated test that verifies the status code and response body.

### Step 5: Connect the frontend to the API

The browser must successfully trigger a health request to the FastAPI service.

Prefer a server-side Next.js proxy route at `/api/health` that calls the backend. Read the backend base URL from:

```env
API_URL=http://127.0.0.1:8000
```

The interface should display a small status such as:

- `Checking API…`
- `API connected`
- `API offline`

Handle backend failures without crashing the page.

### Step 6: Render the Toronto map

Create a full-screen MapLibre component that:

- Is centered on downtown Toronto
- Uses approximately `[-79.3832, 43.6532]` as its initial center
- Includes zoom and navigation controls
- Includes a marker for the hard-coded starting point
- Displays visible OpenStreetMap attribution
- Loads only in the browser and does not break Next.js server-side rendering

Read the style URL from:

```env
NEXT_PUBLIC_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
```

The MapLibre demo style is acceptable for local development. It is not the production tile-provider decision.

Do not configure public OpenStreetMap tile servers as the production provider. Before beta, RouteGrade must use a suitable hosted MapLibre-compatible provider and follow its attribution and usage requirements.

### Step 7: Add the sample route

Create a small GeoJSON fixture at:

```text
apps/web/src/fixtures/sample-route.json
```

Requirements:

- Use a `FeatureCollection` containing a `LineString`.
- Keep the coordinates near downtown Toronto.
- Render the route as a clearly visible colored line.
- Use rounded line joins and caps.
- Initially hide the route if practical.
- Display it after the user clicks **Find routes**.

### Step 8: Add the route form

The form must include:

- Starting address input
- **Use my location** button
- Distance input in kilometres
- Quiet/Flat/Scenic selector
- **Find routes** button

For this milestone:

- The starting address does not need geocoding.
- The location button may only update the form state.
- The preference does not need to change the route.
- The distance does not need to change the route geometry.
- Clicking **Find routes** should reveal the sample route.

The form must remain usable at a phone-sized viewport. Place it over the map as a compact card on larger screens and ensure it fits without horizontal overflow on mobile.

### Step 9: Document local development

Update the root `README.md` with:

- A short RouteGrade description
- Repository structure
- Prerequisites
- Backend start command
- Frontend start command
- Health endpoint URL
- Test, lint, and build commands
- Environment-variable setup
- Tile-provider warning

Expected development commands:

```bash
# Terminal 1
cd services/api
uv run uvicorn main:app --reload
```

```bash
# Terminal 2
cd apps/web
cp .env.example .env.local
pnpm install
pnpm dev
```

## Acceptance criteria

The milestone is complete only when all of the following are true:

- [ ] `GET /health` returns the required JSON response.
- [ ] The backend health test passes.
- [ ] The frontend loads without a runtime error.
- [ ] A map of downtown Toronto is visible.
- [ ] Map zoom controls are visible and functional.
- [ ] A starting-point marker is visible.
- [ ] OpenStreetMap attribution is visible.
- [ ] The map style URL comes from an environment variable.
- [ ] The route form contains every required field and control.
- [ ] The form is usable on a phone-sized screen.
- [ ] Clicking **Find routes** displays the sample route.
- [ ] The frontend successfully reaches the backend health endpoint.
- [ ] Backend failure is represented gracefully in the UI.
- [ ] No public OpenStreetMap tile server is presented as the production provider.
- [ ] Setup and run instructions are documented.

## Required validation

Run every relevant check before reporting completion.

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

### Integration

Start both services and confirm that these return HTTP 200:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:3000/api/health
```

Both responses should contain:

```json
{"status":"ok","service":"routegrade-api"}
```

## Git instructions

1. Do not commit generated directories such as `node_modules`, `.next`, `.venv`, `__pycache__`, or test caches.
2. Review `git status` and `git diff --check` before committing.
3. Ensure `.env.example` is committed, but never commit `.env.local` or secrets.
4. Keep the milestone in one focused commit unless an existing repository convention requires otherwise.
5. Use this commit message:

```text
Build RouteGrade walking skeleton
```

6. Push only after every required validation passes.

## Constraints

Do not add any of the following during this milestone:

- Authentication
- A production database
- Real route generation
- Address geocoding
- Route scoring algorithms
- User accounts
- Payments
- Analytics tracking
- Deployment infrastructure
- A complex state-management library
- Premature component or service abstractions

If you discover an issue outside this scope, document it instead of expanding the milestone automatically.

## Final report format

When finished, report:

1. What was implemented
2. The important files created or changed
3. Validation results
4. The commit SHA and pushed branch, if publishing was requested
5. Any remaining limitation or manual setup step

Do not claim completion if any required validation failed. Include the exact failure and the recommended next action instead.