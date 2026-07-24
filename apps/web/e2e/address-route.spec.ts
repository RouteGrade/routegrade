import { test, expect, type Page } from "@playwright/test";
import { blockExternalRequests } from "./fixtures/plan";

/**
 * "Create your own route" — the address-based multi-stop builder that replaces
 * the shelved freehand draw tool. Enter start/end (+ stops), route through them
 * (optionally as a loop), then name + grade. Geocode/segment/custom/alternatives
 * are stubbed so no backend/OSRM is needed.
 */

const GRADED = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "My commute loop",
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [-79.3832, 43.6519],
      [-79.3845, 43.6516],
      [-79.3860, 43.6512],
    ],
  },
  distance_km: 4.1,
  elevation_gain_m: 18,
  intersections_per_km: 5,
  sidewalk_coverage: null,
  score: 79,
  grade: "C" as const,
  elevation_subscore: 85,
  intersection_subscore: 74,
  within_tolerance: true,
  provider: "osrm-segment",
};

const SEG = {
  geometry: GRADED.geometry,
  distance_km: 2.0,
};

async function mockBackend(page: Page): Promise<void> {
  let geocodeN = 0;
  await page.route("**/v1/routes/geocode", async (route) => {
    // Return distinct points so start/end differ.
    geocodeN += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        latitude: 43.65 + geocodeN * 0.002,
        longitude: -79.38 - geocodeN * 0.002,
        label: `Geocoded ${geocodeN}`,
      }),
    });
  });
  await page.route("**/v1/routes/segment", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SEG) }),
  );
  await page.route("**/v1/routes/alternatives", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ routes: [{ geometry: GRADED.geometry, distance_km: 2.2 }] }),
    }),
  );
  await page.route("**/v1/routes/custom", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GRADED) }),
  );
  await page.route("**/api/health", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "offline" }),
    }),
  );
}

test.describe("create your own route (address builder)", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "rg_guest", value: "1", url: "http://localhost:3000" },
    ]);
    await mockBackend(page);
    await blockExternalRequests(page);
    await page.goto("/");
  });

  test("enter start + end, build a route, name and grade it", async ({ page }) => {
    await page.getByRole("button", { name: "Create your own route" }).click();
    await page.getByPlaceholder("Start address").fill("Nathan Phillips Square");
    await page.getByPlaceholder("End address").fill("High Park");
    await page.getByRole("button", { name: "Build route" }).click();

    // The routed structure lands on the shared name/edit panel.
    await expect(page.getByText("Name your route")).toBeVisible();
    // Draggable waypoint handles are on the map.
    await expect(page.locator(".maplibregl-marker").first()).toBeVisible();

    await page.getByPlaceholder("My route").fill("My commute loop");
    await page.getByRole("button", { name: "Grade this route" }).click();

    await expect(page.getByRole("heading", { name: "My commute loop" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start run" })).toBeVisible();
  });

  test("add a stop and toggle loop, then build", async ({ page }) => {
    await page.getByRole("button", { name: "Create your own route" }).click();
    await page.getByPlaceholder("Start address").fill("A");
    await page.getByRole("button", { name: "Add stop" }).click();
    await page.getByPlaceholder("Stop 1").fill("B");
    await page.getByPlaceholder("End address").fill("C");
    await page.getByRole("button", { name: "Loop" }).click();
    await page.getByRole("button", { name: "Build route" }).click();

    await expect(page.getByText("Name your route")).toBeVisible();
  });

  test("shows an error when start/end are missing", async ({ page }) => {
    await page.getByRole("button", { name: "Create your own route" }).click();
    await page.getByRole("button", { name: "Build route" }).click();
    await expect(page.getByText(/Enter at least a start and an end/)).toBeVisible();
  });
});
