// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedRun } from "@/lib/api/runs-client";

/**
 * The Activity tab's period switcher, which shipped in PR5 with no rendering
 * coverage at all — the DOM environment that makes this testable only landed
 * afterwards in #39.
 *
 * `lib/activity.test.ts` already covers the period arithmetic. What is tested
 * here is the wiring: that the toggle actually re-scopes the figures, that the
 * default lands where it was meant to, and that an empty period is reported
 * honestly rather than looking like a broken screen.
 */

const { listRuns, deleteRun } = vi.hoisted(() => ({
  listRuns: vi.fn(),
  deleteRun: vi.fn(),
}));

vi.mock("@/lib/api/runs-client", () => ({ listRuns, deleteRun }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { RunsSection } = await import("./runs-section");

function run(partial: Partial<RecordedRun>): RecordedRun {
  return {
    id: "r",
    route_id: null,
    route_name: null,
    activity: "run",
    started_at: "2026-07-01T10:00:00Z",
    duration_s: 0,
    distance_km: 0,
    avg_pace_s_per_km: null,
    splits: [],
    path: null,
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    ...partial,
  };
}

/** A run `daysAgo` before now, in local time — the timezone the tab scopes by. */
function runDaysAgo(daysAgo: number, partial: Partial<RecordedRun> = {}) {
  const when = new Date();
  when.setDate(when.getDate() - daysAgo);
  when.setHours(12, 0, 0, 0);
  return run({ started_at: when.toISOString(), ...partial });
}

const totalsRegion = () => screen.getByRole("region", { name: "Totals" });
/** Resolves once the fetch has settled and the totals block is on screen. */
const loaded = () => screen.findByRole("region", { name: "Totals" });
const periodButton = (name: string) =>
  within(screen.getByRole("group", { name: "Totals period" })).getByRole("button", {
    name,
  });

beforeEach(() => {
  listRuns.mockReset();
  deleteRun.mockReset();
  listRuns.mockResolvedValue([]);
});

afterEach(cleanup);

describe("RunsSection · load states", () => {
  it("announces a failure rather than an empty history", async () => {
    listRuns.mockRejectedValue(new Error("boom"));
    render(<RunsSection />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't load your runs/i);
    // An empty state here would claim "you have never run", which is a
    // different and worse statement than "we could not load this".
    expect(screen.queryByText("No runs yet")).toBeNull();
  });

  it("shows the empty state when there is genuinely no history", async () => {
    render(<RunsSection />);
    expect(await screen.findByText("No runs yet")).toBeTruthy();
  });
});

describe("RunsSection · period switcher", () => {
  it("defaults to this month, not this week", async () => {
    listRuns.mockResolvedValue([runDaysAgo(0, { distance_km: 5, duration_s: 1500 })]);
    render(<RunsSection />);

    await loaded();
    expect(periodButton("month").getAttribute("aria-pressed")).toBe("true");
    expect(periodButton("week").getAttribute("aria-pressed")).toBe("false");
    expect(within(totalsRegion()).getByText("This month")).toBeTruthy();
  });

  it("re-scopes the totals when a different period is chosen", async () => {
    // One run today, one 200 days ago. "This year" may or may not contain the
    // older run depending on the date, so this asserts the direction of the
    // change rather than a fixed number: widening the window can only add.
    listRuns.mockResolvedValue([
      runDaysAgo(0, { distance_km: 5, duration_s: 1500 }),
      runDaysAgo(200, { distance_km: 12, duration_s: 3600 }),
    ]);
    render(<RunsSection />);

    await loaded();
    // The hero renders the figure and its "km" unit in one <p>, so textContent
    // is "5.0km" — parseFloat rather than Number, which would give NaN.
    const readDistance = () =>
      parseFloat(
        within(totalsRegion()).getByText(/^\d+\.\d$/).textContent ?? "",
      );

    const monthKm = readDistance();
    expect(monthKm).toBeCloseTo(5, 1);

    fireEvent.click(periodButton("year"));
    expect(within(totalsRegion()).getByText("This year")).toBeTruthy();
    expect(readDistance()).toBeGreaterThanOrEqual(monthKm);
  });

  it("reports an empty period as zero instead of borrowing from a wider one", async () => {
    // A run from last year is real history, but it is not "this week".
    listRuns.mockResolvedValue([runDaysAgo(400, { distance_km: 9, duration_s: 2700 })]);
    render(<RunsSection />);

    await loaded();
    fireEvent.click(periodButton("week"));

    const totals = totalsRegion();
    expect(within(totals).getByText("0.0")).toBeTruthy();
    // Pace has nothing to average over, so it must not read as 0:00.
    expect(within(totals).getByText("—:—")).toBeTruthy();
  });

  it("keeps the whole history listed regardless of the period", async () => {
    // The switcher scopes the TOTALS only. Hiding runs from the list would
    // make deleting an older run impossible without changing tabs.
    listRuns.mockResolvedValue([
      runDaysAgo(0, { id: "recent", route_name: "Today loop", distance_km: 5, duration_s: 1500 }),
      runDaysAgo(400, { id: "ancient", route_name: "Last year", distance_km: 9, duration_s: 2700 }),
    ]);
    render(<RunsSection />);

    await loaded();
    fireEvent.click(periodButton("week"));

    expect(screen.getByText("Today loop")).toBeTruthy();
    expect(screen.getByText("Last year")).toBeTruthy();
  });
});

describe("RunsSection · history list", () => {
  it("links each run to its detail screen", async () => {
    listRuns.mockResolvedValue([
      runDaysAgo(0, { id: "run-1", distance_km: 5, duration_s: 1500 }),
    ]);
    render(<RunsSection />);

    await loaded();
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/activity/run-1");
    expect(link).toBeTruthy();
  });

  it("offers a labelled delete control per run", async () => {
    listRuns.mockResolvedValue([
      runDaysAgo(0, { id: "run-1", distance_km: 5, duration_s: 1500 }),
    ]);
    render(<RunsSection />);

    await loaded();
    expect(screen.getByRole("button", { name: /^Delete run from/ })).toBeTruthy();
  });
});
