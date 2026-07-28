import { test, expect } from "@playwright/test";
import { blockExternalRequests } from "./fixtures/plan";

/**
 * Activity tab routing and its signed-out surface.
 *
 * The suite has no Supabase session, so the signed-in Activity UI (totals, run
 * cards, the per-run detail with splits) can't be driven end-to-end here — that
 * logic is covered by unit tests over `lib/activity.ts` instead. What these do
 * cover is the part that only a browser can answer: that the new nested route
 * exists and resolves, that an unauthenticated visitor gets a prompt rather
 * than an error, that the deep link they'd return to is preserved, and that the
 * tab bar keeps the Activity tab selected on a nested route.
 */

test.describe("activity tab", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "rg_guest", value: "1", url: "http://localhost:3000" },
    ]);
    await blockExternalRequests(page);
  });

  test("prompts a signed-out visitor instead of erroring", async ({ page }) => {
    await page.goto("/activity");

    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login?next=%2Factivity");
  });

  test("a run deep link resolves and preserves where to return to", async ({
    page,
  }) => {
    const runId = "3f6b1a2c-0000-4000-8000-000000000001";
    await page.goto(`/activity/${runId}`);

    // The route exists (not a 404) and asks for a session for *this* run.
    await expect(page.getByRole("heading", { name: "Run" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?next=%2Factivity%2F${runId}`,
    );
  });

  test("keeps the Activity tab selected on a nested run route", async ({
    page,
  }) => {
    await page.goto("/activity/3f6b1a2c-0000-4000-8000-000000000001");

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Run" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the Activity tab is reachable from the tab bar", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Activity" })
      .click();

    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  });
});
