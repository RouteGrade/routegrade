import { test, expect, type Page } from "@playwright/test";
import { blockExternalRequests, mockRoutePlanning } from "./fixtures/plan";
import { stepIndexForDistance } from "@/lib/distance-scale";

/**
 * The Run tab's idle screen: a search pill, the run goal in display type, and
 * one primary action, over a full-bleed map.
 *
 * Distance and vibe moved out of an always-open form into a sheet behind the
 * goal readout, so these cover the round trip: open the sheet, change a
 * parameter, see it reflected on the hero, and have it actually feed the plan
 * request.
 *
 * Hermetic: planning is stubbed (fixtures/plan.ts). The rg_guest cookie makes
 * this a returning guest so the entry gate serves the planner at / rather than
 * redirecting to /login.
 */

const goalButton = (page: Page) =>
  page.getByRole("button", { name: /^Distance .* Change$/ });
const findButton = (page: Page) =>
  page.getByRole("button", { name: "Find routes" });
const distanceSlider = (page: Page) => page.getByLabel("Distance", { exact: true });

/**
 * The slider's value is a position on the distance ladder, not kilometres
 * (lib/distance-scale.ts), so these tests ask for a distance and let the shared
 * module do the conversion rather than hard-coding indices that would drift the
 * moment the ladder changes.
 */
const setDistance = (page: Page, km: number) =>
  distanceSlider(page).fill(String(stepIndexForDistance(km)));

test.describe("run tab · idle screen", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "rg_guest", value: "1", url: "http://localhost:3000" },
    ]);
    await mockRoutePlanning(page);
    await blockExternalRequests(page);
    await page.goto("/");
  });

  test("shows the goal and the primary action over the map", async ({ page }) => {
    await expect(goalButton(page)).toBeVisible();
    await expect(findButton(page)).toBeVisible();
    // The default 5.0 km goal is the loudest thing on the screen.
    await expect(goalButton(page)).toContainText("5.0");
    await expect(goalButton(page)).toContainText("Quiet");
    // The old always-open form is gone: options live behind the goal.
    await expect(page.getByRole("radiogroup", { name: "Route preference" })).toHaveCount(0);
  });

  test("the goal opens a sheet, and changes there show on the hero", async ({
    page,
  }) => {
    await goalButton(page).click();

    const vibes = page.getByRole("radiogroup", { name: "Route preference" });
    await expect(vibes).toBeVisible();

    await setDistance(page, 8);
    await page.getByRole("radio", { name: "Scenic" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    await expect(vibes).toHaveCount(0);
    await expect(goalButton(page)).toContainText("8.0");
    await expect(goalButton(page)).toContainText("Scenic");
  });

  test("parameters chosen in the sheet are sent with the plan request", async ({
    page,
  }) => {
    const planRequest = page.waitForRequest(
      (req) => req.url().includes("/routes/plan") && req.method() === "POST",
    );

    await goalButton(page).click();
    await setDistance(page, 3.5);
    await page.getByRole("radio", { name: "Flat" }).click();
    await page.getByRole("button", { name: "Done" }).click();

    await page
      .getByPlaceholder("Nathan Phillips Square, Toronto")
      .fill("Nathan Phillips Square, Toronto");
    await findButton(page).click();

    const body = (await planRequest).postDataJSON();
    expect(body.distance_km).toBe(3.5);
    expect(body.preference).toBe("flat");
  });

  test("the slider reaches ride-length distances", async ({ page }) => {
    // Founder request, 2026-08-05: 15 km was a running-only ceiling. This is the
    // behaviour that makes the planner usable for a ride, so it gets its own
    // test rather than riding along on the 3.5 km case.
    const planRequest = page.waitForRequest(
      (req) => req.url().includes("/routes/plan") && req.method() === "POST",
    );

    await goalButton(page).click();
    await setDistance(page, 100);
    await page.getByRole("button", { name: "Done" }).click();

    // Whole numbers past the half-kilometre band read "100", not "100.0".
    await expect(goalButton(page)).toContainText("100");

    await page
      .getByPlaceholder("Nathan Phillips Square, Toronto")
      .fill("Nathan Phillips Square, Toronto");
    await findButton(page).click();

    expect((await planRequest).postDataJSON().distance_km).toBe(100);
  });

  test("a found route can be dismissed to get back to the search", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Nathan Phillips Square, Toronto")
      .fill("Nathan Phillips Square, Toronto");
    await findButton(page).click();

    // A result takes the screen, so the hero (and the search field) is gone.
    await expect(page.getByRole("button", { name: "Start run" })).toBeVisible();
    await expect(findButton(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Back to search" }).click();

    await expect(page.getByRole("button", { name: "Start run" })).toHaveCount(0);
    await expect(findButton(page)).toBeVisible();
    await expect(goalButton(page)).toBeVisible();
  });

  test("tapping the backdrop dismisses the sheet without losing the change", async ({
    page,
  }) => {
    await goalButton(page).click();
    await setDistance(page, 12);
    await page.getByRole("button", { name: "Close route options" }).click();

    await expect(
      page.getByRole("radiogroup", { name: "Route preference" }),
    ).toHaveCount(0);
    await expect(goalButton(page)).toContainText("12.0");
  });
});
