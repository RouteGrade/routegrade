import { test, expect, type Page } from "@playwright/test";
import {
  blockExternalRequests,
  FIXTURE_ROUTE_NAME,
  mockRoutePlanning,
} from "./fixtures/plan";

/**
 * Guest plan persistence across sign-in (Backlog: "Phase 3: Preserve the
 * guest's in-progress route across 'sign in to save'").
 *
 * A guest who taps "Sign in to save this route" bounces through /login?next=/;
 * the plan lives in React state, not the URL, so without persistence they'd
 * land back on a blank planner. route-explorer stashes the plan in
 * sessionStorage on the way out and rehydrates it on the next planner mount.
 *
 * Hermetic: planning is stubbed (fixtures/plan.ts), no backend/Supabase needed.
 * The rg_guest cookie makes this a *returning* guest so the entry gate (see
 * proxy.ts) serves the planner at / instead of redirecting to /login.
 */

const ADDRESS = "Nathan Phillips Square, Toronto";
const STASH_KEY = "rg_guest_plan";

const saveLink = (page: Page) =>
  page.getByRole("link", { name: "Sign in to save this route" });
const startRunButton = (page: Page) =>
  page.getByRole("button", { name: "Start run" });

async function planAsGuest(page: Page): Promise<void> {
  await page.getByPlaceholder(ADDRESS).fill(ADDRESS);
  await page.getByRole("button", { name: "Find routes" }).click();
  await expect(saveLink(page)).toBeVisible();
}

test.describe("guest plan persistence across sign-in", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "rg_guest", value: "1", url: "http://localhost:3000" },
    ]);
    await mockRoutePlanning(page);
    await blockExternalRequests(page);
  });

  test("stashes the plan on 'sign in to save' and restores it on return", async ({
    page,
  }) => {
    await page.goto("/");
    await planAsGuest(page);

    // Nothing stashed until the guest actually heads to sign in.
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STASH_KEY)).toBeNull();

    // Clicking the CTA stashes the plan, then navigates to /login.
    await saveLink(page).click();
    await expect(page).toHaveURL(/\/login/);
    const stashed = await page.evaluate((k) => sessionStorage.getItem(k), STASH_KEY);
    expect(stashed).toContain(FIXTURE_ROUTE_NAME);

    // Returning to the planner (as the post-auth redirect would) rehydrates the
    // plan without re-planning, and consumes the stash.
    await page.goto("/");
    await expect(startRunButton(page)).toBeVisible();
    await expect(saveLink(page)).toBeVisible();
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STASH_KEY)).toBeNull();
  });

  test("a fresh planner mount with no stash shows no restored plan", async ({
    page,
  }) => {
    await page.goto("/");
    // No plan was made and nothing is stashed, so no result card appears.
    await expect(startRunButton(page)).toHaveCount(0);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STASH_KEY)).toBeNull();
  });
});
