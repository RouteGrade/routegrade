import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_ROUTE_NAME,
  ROUTE_DISTANCE_KM,
  blockExternalRequests,
  mockRoutePlanning,
  stubSpeechSynthesis,
} from "./fixtures/plan";

/**
 * Run-tracker regression suite (Backlog: "Run-tracker regression suite via
 * ?simulate=1", MS6 Phase C).
 *
 * These tests exercise the live-run flow end to end through the tracker's
 * built-in simulate mode — no real GPS, device, or backend. Planning is stubbed
 * (see fixtures/plan.ts); everything from countdown through the summary screen
 * is the real component.
 *
 * Time control: RunTracker's countdown, moving-time clock, and the simulator
 * itself are all timer-driven, and the simulator only advances ~3.2 m/s of
 * virtual distance per real second — reaching a kilometre split in real time
 * would take >5 minutes. We install Playwright's clock so we can fast-forward
 * virtual time deterministically. The countdown is a chain of setTimeouts that
 * React re-schedules on each tick, so it must be stepped (each `runFor` lets
 * React commit and schedule the next one); the simulator is a self-rescheduling
 * setInterval, so a single large `runFor` fires it many times.
 */

const ADDRESS = "Nathan Phillips Square, Toronto";

const pauseButton = (page: Page) => page.getByRole("button", { name: "Pause run" });
const resumeButton = (page: Page) => page.getByRole("button", { name: "Resume run" });
const finishButton = (page: Page) => page.getByRole("button", { name: "Finish run" });
const startRunButton = (page: Page) => page.getByRole("button", { name: "Start run" });
/** The large live/summary distance readout (`km.toFixed(2)`). */
const distanceReadout = (page: Page) => page.locator("span.font-display.text-6xl").first();

async function readDistanceKm(page: Page): Promise<number> {
  const text = await distanceReadout(page).textContent();
  return Number(text?.trim() ?? "NaN");
}

/** Load the planner with the simulator armed and the network stubbed. */
async function gotoPlanner(page: Page): Promise<void> {
  await mockRoutePlanning(page);
  await blockExternalRequests(page);
  await stubSpeechSynthesis(page);
  // Clock must be installed before the page's scripts run so the tracker's
  // timers are the mocked ones.
  await page.clock.install();
  // `?simulate` must be present in the URL at the moment RunTracker mounts.
  await page.goto("/?simulate");
}

/** Plan the fixture route and wait for the result card's "Start run" CTA. */
async function planFixtureRoute(page: Page): Promise<void> {
  await page.getByPlaceholder(ADDRESS).fill(ADDRESS);
  await page.getByRole("button", { name: "Find routes" }).click();
  await expect(startRunButton(page)).toBeVisible();
}

/**
 * Step the clock through the 3-2-1-GO countdown until the run is live. Stepping
 * (rather than one big jump) is required because each countdown timeout is
 * re-scheduled by a React effect only after the previous one commits.
 */
async function startRunAndPassCountdown(page: Page): Promise<void> {
  await startRunButton(page).click();
  const pause = pauseButton(page);
  for (let i = 0; i < 15; i++) {
    if (await pause.isVisible()) break;
    await page.clock.runFor(1000);
  }
  await expect(pause).toBeVisible();
}

/**
 * Fast-forward virtual time while the run is live. Chunked so React commits
 * between jumps; the self-rescheduling simulator interval fires ~once per
 * virtual second regardless.
 */
async function advanceRun(page: Page, ms: number): Promise<void> {
  const step = 20_000;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await page.clock.runFor(Math.min(step, ms - elapsed));
  }
}

test.describe("run tracker · simulate mode", () => {
  test("planner loads and plans the fixture route", async ({ page }) => {
    await gotoPlanner(page);
    await planFixtureRoute(page);
    await expect(page.getByRole("heading", { name: FIXTURE_ROUTE_NAME })).toBeVisible();
    await expect(page.getByText(`${ROUTE_DISTANCE_KM.toFixed(1)} km`)).toBeVisible();
  });

  test("live stats update as the simulated runner moves", async ({ page }) => {
    await gotoPlanner(page);
    await planFixtureRoute(page);
    await startRunAndPassCountdown(page);

    // Nothing has moved yet.
    expect(await readDistanceKm(page)).toBe(0);

    // ~130 m of simulated travel (enough for distance, current + avg pace).
    await advanceRun(page, 40_000);

    await expect.poll(() => readDistanceKm(page)).toBeGreaterThan(0);

    // Moving-time clock is running.
    await expect(page.locator("dd").filter({ hasText: /^\d+:\d{2}$/ }).first()).toBeVisible();

    // Avg pace resolves to a real value once >50 m is covered (no longer "—:—").
    const avgPace = page
      .locator("dt", { hasText: "Avg pace" })
      .locator("xpath=following-sibling::dd");
    await expect(avgPace).toHaveText(/\d+:\d{2} \/km/);

    // Route progress: remaining distance ticks down from the full ~2.5 km.
    await expect(page.getByText(/km left/)).not.toHaveText(
      `${ROUTE_DISTANCE_KM.toFixed(1)} km left`,
    );
  });

  test("reaches a km split, pauses/resumes, and finishes to the summary", async ({ page }) => {
    await gotoPlanner(page);
    await planFixtureRoute(page);
    await startRunAndPassCountdown(page);

    // Drive past 1 km (~350 s × 3.2 m/s ≈ 1.1 km) to produce a kilometre split.
    await advanceRun(page, 350_000);
    await expect.poll(() => readDistanceKm(page)).toBeGreaterThan(1);

    // Pause exposes the finish + resume controls.
    await pauseButton(page).click();
    await expect(finishButton(page)).toBeVisible();
    await expect(resumeButton(page)).toBeVisible();
    await expect(page.getByText("Paused — press stop to finish your run")).toBeVisible();

    // Resume keeps accumulating, then pause again before finishing.
    await resumeButton(page).click();
    await expect(pauseButton(page)).toBeVisible();
    await advanceRun(page, 10_000);
    await pauseButton(page).click();

    // Finish → summary.
    await finishButton(page).click();
    await expect(page.getByText("Run complete")).toBeVisible();
    await expect(page.getByRole("heading", { name: FIXTURE_ROUTE_NAME })).toBeVisible();

    // Splits list rendered with at least the first kilometre.
    await expect(page.getByRole("heading", { name: "Splits" })).toBeVisible();
    await expect(page.getByText("km 1", { exact: true })).toBeVisible();

    // Summary distance carried over (still ~1.1 km).
    await expect.poll(() => readDistanceKm(page)).toBeGreaterThan(1);

    // Guest (unauthenticated) sees the sign-in-to-save CTA, not a save button.
    await expect(
      page.getByRole("link", { name: /Sign in to save & rate this run/ }),
    ).toBeVisible();
  });

  test("mute toggle flips the audio-cue control", async ({ page }) => {
    await gotoPlanner(page);
    await planFixtureRoute(page);
    await startRunAndPassCountdown(page);

    const mute = page.getByRole("button", { name: "Mute audio cues" });
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await mute.click();

    const unmute = page.getByRole("button", { name: "Unmute audio cues" });
    await expect(unmute).toBeVisible();
    await expect(unmute).toHaveAttribute("aria-pressed", "true");
  });

  test("exit confirmation dialog guards leaving mid-run", async ({ page }) => {
    await gotoPlanner(page);
    await planFixtureRoute(page);
    await startRunAndPassCountdown(page);

    const exit = page.getByRole("button", { name: "Exit run" });

    // Dismissing the confirm keeps the run alive.
    page.once("dialog", (dialog) => dialog.dismiss());
    await exit.click();
    await expect(pauseButton(page)).toBeVisible();

    // Accepting returns to the planner (the result card + Start run reappear).
    page.once("dialog", (dialog) => dialog.accept());
    await exit.click();
    await expect(startRunButton(page)).toBeVisible();
  });

  // Off-route detection is intentionally NOT covered here. Simulate mode always
  // walks the literal route geometry via `pointAtDistanceM`, so the runner's
  // projected distance-to-path is ~0 and `offRoute` can never flip. Exercising
  // the off-route alert would require feeding divergent fixes, which simulate
  // mode cannot do — it needs a separate injectable-fix hook or a unit test
  // against `handleFix`/`projectOntoPath`. Flagged as a known gap.
  test.fixme(
    "off-route alert appears when the runner diverges (untestable via simulate)",
    () => {},
  );
});
