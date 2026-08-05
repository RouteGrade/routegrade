import { expect, test } from "@playwright/test";

/**
 * The install step on /login, in a real browser.
 *
 * The unit tests cover the platform matrix (see `src/lib/pwa/install.test.ts`);
 * what only a browser can show is that the overlay actually reaches the screen
 * on a phone, that the sign-in form is still there behind it, and that a
 * dismissal written to localStorage survives a real page load.
 *
 * The suite's one project is Desktop Chrome, so this file overrides the user
 * agent per-test rather than adding a second project and running everything
 * twice for the sake of one screen.
 */

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test.describe("add to home screen", () => {
  test.use({
    userAgent: IPHONE_SAFARI,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });

  test("greets a new iPhone visitor, and stays gone once turned down", async ({
    page,
  }) => {
    await page.goto("/login");

    const step = page.getByRole("dialog", { name: /home screen/i });
    await expect(step).toBeVisible();

    // iOS has no install API, so the payload is the replica share sheet with
    // the target row picked out — not a wall of numbered instructions.
    // `exact` throughout: Playwright's text matching is substring-based, and
    // the screen-reader step list repeats all of these inside longer sentences.
    await expect(step.getByText("Add to Home Screen", { exact: true })).toBeVisible();
    await expect(step.getByText("Add to Reading List", { exact: true })).toBeVisible();
    await expect(step.getByText("Share", { exact: true })).toBeVisible();

    await step.getByRole("button", { name: /continue in the browser/i }).click();
    await expect(step).toBeHidden();

    // Sign-in was never blocked, only covered.
    await expect(
      page.getByRole("heading", { name: "Sign in to RouteGrade" }),
    ).toBeVisible();

    // The dismissal has to outlive the page, not just the React tree — this is
    // the assertion that fails if it were held in component state.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Sign in to RouteGrade" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("stays away from a visitor already running the installed app", async ({
    page,
  }) => {
    // What iOS reports to a page launched from the Home Screen. Set before any
    // app code runs, so detection sees it on the first pass.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true });
    });

    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Sign in to RouteGrade" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("add to home screen · desktop", () => {
  test("never interrupts a desktop visitor", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Sign in to RouteGrade" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
