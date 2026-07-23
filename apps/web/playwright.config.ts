import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for apps/web.
 *
 * Boots the Next.js dev server (reusing an already-running one locally) and
 * runs the run-tracker regression suite against it in headless Chromium. The
 * suite is hermetic — it stubs the plan endpoint and never reaches the FastAPI
 * backend or external geocoders (see e2e/fixtures/plan.ts) — so no backend,
 * Supabase credentials, or network access are required.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "playwright-results.xml" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The planner works without Supabase/backend config; keep the guest flow.
    stdout: "pipe",
    stderr: "pipe",
  },
});
