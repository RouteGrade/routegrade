import { test, expect, type Page } from "@playwright/test";
import { blockExternalRequests } from "./fixtures/plan";

/**
 * Draw-your-own-route (Backlog: "Draw-your-own-route Phase 2/3").
 *
 * Drives the real freehand draw interaction: enter draw mode, drag across the
 * map canvas to draw a path, name it, and grade it. /v1/routes/custom is
 * stubbed so no backend/OSRM is needed; the map style is blocked for
 * hermeticity (the map transform still unprojects pointer positions without a
 * loaded style, exactly as the run-tracker suite relies on).
 */

const CUSTOM_ROUTE = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "My waterfront loop",
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [-79.3832, 43.6519],
      [-79.3845, 43.6516],
      [-79.3860, 43.6512],
    ],
  },
  distance_km: 3.2,
  elevation_gain_m: 12,
  intersections_per_km: 4.0,
  sidewalk_coverage: null,
  score: 82,
  grade: "B" as const,
  elevation_subscore: 90,
  intersection_subscore: 80,
  within_tolerance: true,
  provider: "osrm-match",
};

async function mockCustom(page: Page): Promise<void> {
  await page.route("**/v1/routes/custom", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CUSTOM_ROUTE),
    });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "offline", service: "routegrade-api" }),
    }),
  );
}

/** Drag a freehand stroke across the map canvas. */
async function drawStroke(page: Page): Promise<void> {
  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas not found");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 80, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx - 20, cy);
  await page.mouse.move(cx + 30, cy + 20);
  await page.mouse.move(cx + 90, cy + 40);
  await page.mouse.up();
}

test.describe("draw your own route", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "rg_guest", value: "1", url: "http://localhost:3000" },
    ]);
    await mockCustom(page);
    await blockExternalRequests(page);
    await page.goto("/");
  });

  test("draw, name, and grade a custom route", async ({ page }) => {
    await page.getByRole("button", { name: "Draw your own route" }).click();
    await expect(
      page.getByText(/Press and drag on the map to draw your route/),
    ).toBeVisible();

    await drawStroke(page);

    // A completed stroke reveals the name + grade panel.
    await expect(page.getByText("Name your route")).toBeVisible();
    await page.getByPlaceholder("My route").fill("My waterfront loop");
    await page.getByRole("button", { name: "Grade this route" }).click();

    // The graded route lands on the normal result card, so Start-run works.
    await expect(page.getByRole("heading", { name: "My waterfront loop" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start run" })).toBeVisible();
    // Guest sees the sign-in-to-save CTA (save stays gated).
    await expect(
      page.getByRole("link", { name: "Sign in to save this route" }),
    ).toBeVisible();
  });

  test("cancel leaves draw mode with no route", async ({ page }) => {
    await page.getByRole("button", { name: "Draw your own route" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByText(/Press and drag on the map/),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start run" })).toHaveCount(0);
  });
});
