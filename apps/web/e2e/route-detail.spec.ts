import { test, expect, type Page } from "@playwright/test";
import {
  blockExternalRequests,
  mockRoutePlanning,
  planResponseBody,
} from "./fixtures/plan";

/**
 * The route detail screen — what you get after RouteGrade finds you something.
 *
 * The grade is the product's reason to exist, so these assert it is actually
 * presented as the headline (letter + plain-language verdict), that switching
 * between candidates swaps the whole readout, and that the factor breakdown is
 * shown when the API supplies sub-scores and honestly *omitted* when it doesn't
 * — the latter being the case that used to render "NaN" bars.
 */

const ADDRESS = "Nathan Phillips Square, Toronto";

/** "Elevation" is both a headline stat and a scoring factor — scope to the
 *  breakdown so assertions can tell the two apart. */
const whyThisGrade = (page: Page) =>
  page.getByRole("region", { name: "Why this grade" });

async function planRoute(page: Page): Promise<void> {
  await page.getByPlaceholder(ADDRESS).fill(ADDRESS);
  await page.getByRole("button", { name: "Find routes" }).click();
  await expect(page.getByRole("button", { name: "Start run" })).toBeVisible();
}

/**
 * Two candidates with differing grades, and sub-scores present — neither of
 * which the shared fixture covers.
 */
async function mockTwoCandidates(page: Page): Promise<void> {
  const base = planResponseBody();
  const [first] = base.routes;
  await page.route("**/v1/routes/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        routes: [
          {
            ...first,
            elevation_subscore: 82,
            intersection_subscore: 64,
          },
          {
            ...first,
            id: "22222222-2222-4222-8222-222222222222",
            name: "Second Candidate Loop",
            grade: "C",
            score: 61,
            distance_km: 3.4,
            elevation_subscore: 40,
            intersection_subscore: 55,
          },
        ],
      }),
    });
  });
}

test.describe("route detail screen", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "rg_guest", value: "1", url: "http://localhost:3000" },
    ]);
    await blockExternalRequests(page);
  });

  test("leads with the grade and its plain-language verdict", async ({ page }) => {
    await mockRoutePlanning(page);
    await page.goto("/");
    await planRoute(page);

    // The fixture route grades an A: letter and verdict both surface.
    await expect(page.getByText("Excellent run")).toBeVisible();
    await expect(
      page.getByText("A top-tier route worth coming back to."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Simulated Test Loop" })).toBeVisible();
  });

  test("omits the factor breakdown when the API sends no sub-scores", async ({
    page,
  }) => {
    await mockRoutePlanning(page);
    await page.goto("/");
    await planRoute(page);

    // Regression guard: this route has no sub-scores, which used to render
    // "NaN" progress bars rather than being left out.
    await expect(page.getByText("NaN")).toHaveCount(0);
    await expect(
      whyThisGrade(page).getByText("Elevation", { exact: true }),
    ).toHaveCount(0);
    // The plain-language reasons don't depend on sub-scores, so they stay.
    await expect(whyThisGrade(page)).toBeVisible();
  });

  test("shows factor bars when sub-scores are present", async ({ page }) => {
    await mockTwoCandidates(page);
    await page.goto("/");
    await planRoute(page);

    const why = whyThisGrade(page);
    await expect(why.getByText("Elevation", { exact: true })).toBeVisible();
    await expect(why.getByText("Quietness", { exact: true })).toBeVisible();
    await expect(why.getByText("82", { exact: true })).toBeVisible();
    await expect(why.getByText("64", { exact: true })).toBeVisible();
  });

  test("switching candidates swaps the whole readout", async ({ page }) => {
    await mockTwoCandidates(page);
    await page.goto("/");
    await planRoute(page);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(page.getByText("Excellent run")).toBeVisible();

    await tabs.nth(1).click();

    await expect(page.getByRole("heading", { name: "Second Candidate Loop" })).toBeVisible();
    await expect(page.getByText("Fair run")).toBeVisible();
    await expect(page.getByText("Excellent run")).toHaveCount(0);
    await expect(page.locator("dd", { hasText: "3.4 km" })).toBeVisible();
  });

  test("the share control opens the scorecard", async ({ page }) => {
    await mockRoutePlanning(page);
    await page.goto("/");
    await planRoute(page);

    await page.getByRole("button", { name: "Share scorecard" }).click();
    await expect(page.getByRole("dialog", { name: "Route scorecard" })).toBeVisible();

    await page.getByRole("button", { name: "Close scorecard" }).click();
    await expect(page.getByRole("dialog", { name: "Route scorecard" })).toHaveCount(0);
  });
});
