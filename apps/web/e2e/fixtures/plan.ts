import type { Page } from "@playwright/test";

/**
 * Hermetic fixtures for the run-tracker E2E suite.
 *
 * Route *planning* hits the FastAPI `/v1/routes/plan` endpoint, which in turn
 * depends on external geocoding/routing providers (Nominatim / OSRM /
 * Open-Elevation). None of that is what this suite exercises — we're
 * regression-testing the client-side run tracker's simulate mode — so we stub
 * the plan response instead of standing up the backend + reaching the public
 * internet. That keeps the suite fast and deterministic in CI. If the plan
 * request shape ever changes, this fixture (and the client that builds it) is
 * the single place to update.
 */

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A synthetic ~2.5 km route near downtown Toronto. The simulator walks this
 * literal geometry at 3.2 m/s, so it needs to be comfortably longer than the
 * ~1 km we drive it through (to produce a kilometre split while still leaving
 * road ahead) and dense enough that `projectOntoPath` behaves.
 */
function buildRouteCoordinates(): [number, number][] {
  const start: [number, number] = [-79.3832, 43.6532];
  const coords: [number, number][] = [];
  const segments = 35;
  for (let i = 0; i <= segments; i++) {
    coords.push([
      start[0] + i * 0.0009, // ~72 m east per step
      start[1] + i * 0.00002, // gentle northward drift
    ]);
  }
  return coords;
}

const ROUTE_COORDINATES = buildRouteCoordinates();

export const ROUTE_LENGTH_M = ROUTE_COORDINATES.reduce(
  (total, coord, i) =>
    i === 0 ? 0 : total + haversineMeters(ROUTE_COORDINATES[i - 1], coord),
  0,
);

export const ROUTE_DISTANCE_KM = Number((ROUTE_LENGTH_M / 1000).toFixed(2));

export const FIXTURE_ROUTE_NAME = "Simulated Test Loop";

/** A single-candidate PlanResponse matching `routes-client.ts`'s contract. */
export function planResponseBody() {
  return {
    start: {
      latitude: ROUTE_COORDINATES[0][1],
      longitude: ROUTE_COORDINATES[0][0],
      label: "Nathan Phillips Square, Toronto",
    },
    requested_distance_km: 2.5,
    preference: "quiet" as const,
    distance_tolerance: 0.2,
    routes: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: FIXTURE_ROUTE_NAME,
        geometry: {
          type: "LineString" as const,
          coordinates: ROUTE_COORDINATES,
        },
        distance_km: ROUTE_DISTANCE_KM,
        elevation_gain_m: 24,
        intersections_per_km: 3.1,
        sidewalk_coverage: 0.92,
        score: 88,
        grade: "A" as const,
        within_tolerance: true,
        provider: "fixture",
      },
    ],
  };
}

/**
 * Intercept the plan request so the planner returns our fixture route without
 * touching the backend or the public internet. Also neuters the FastAPI health
 * poll (the pill just shows "offline", which is irrelevant here) to avoid
 * console noise from unreachable-backend fetches during the run.
 */
export async function mockRoutePlanning(page: Page): Promise<void> {
  await page.route("**/v1/routes/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(planResponseBody()),
    });
  });

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "offline", service: "routegrade-api" }),
    });
  });
}

/**
 * Block cross-origin requests (map style JSON, vector tiles, glyphs, sprites).
 *
 * Two reasons: (1) hermeticity — the suite must not depend on external map/tile
 * providers being reachable; (2) determinism under the mocked clock — if
 * MapLibre's style loads, every simulated fix kicks off a ~950 ms `easeTo`
 * camera animation whose requestAnimationFrame callbacks the virtual clock's
 * `runFor` would have to exhaust, exploding fast-forward time. With the style
 * blocked the map never signals "loaded", the camera-follow effect early-
 * returns, and the run-tracker overlay (a separate subtree) is unaffected.
 *
 * Same-origin (localhost / 127.0.0.1) requests — the app itself and the stubbed
 * plan/health endpoints — are left untouched.
 */
export async function blockExternalRequests(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) =>
    route.abort(),
  );
}

/**
 * Speech synthesis is a nice-to-have the tracker already guards with
 * try/catch, but stubbing it keeps the headless browser quiet and deterministic
 * (no real utterances queued against a missing engine).
 */
export async function stubSpeechSynthesis(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-expect-error - overriding for the test environment.
    window.speechSynthesis = {
      speak: () => {},
      cancel: () => {},
      getVoices: () => [],
    };
    // @ts-expect-error - minimal stub, only the constructor is used.
    window.SpeechSynthesisUtterance = class {
      constructor() {}
    };
  });
}
