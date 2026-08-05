// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedRoute } from "@/lib/api/routes-client";
import type { RecordedRun } from "@/lib/api/runs-client";

/**
 * First component test in the repo — see `vitest.config.ts` for how the jsdom
 * environment is opted into per file.
 *
 * This covers the signed-in You tab, which until now had no rendering coverage
 * at all: the e2e suite has no Supabase session, so every branch below was
 * reachable only by hand. The derivations underneath are unit-tested in
 * `lib/profile.test.ts`; what is tested here is the wiring — which block
 * renders in which load state, and that one failing request does not take the
 * other block down with it.
 */

// Hoisted so the `vi.mock` factories below (which are themselves hoisted above
// the imports) can close over them without a TDZ error.
const { listRuns, listSavedRoutes } = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listSavedRoutes: vi.fn(),
}));

vi.mock("@/lib/api/runs-client", () => ({ listRuns }));
vi.mock("@/lib/api/routes-client", () => ({ listSavedRoutes }));
// next/link wants router context we don't need here; the hrefs are what matter.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { RunnerStats } = await import("./runner-stats");

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

function route(partial: Partial<SavedRoute>): SavedRoute {
  return {
    id: "route",
    name: "Loop",
    starting_address: null,
    distance_km: 5,
    preference: "quiet",
    activity: "run",
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    elevation_gain_m: 10,
    intersections_per_km: 2,
    score: 80,
    grade: "B",
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
    ...partial,
  };
}

/** `count` kilometre splits, each taking `durationS`, numbered from 1. */
function splits(count: number, durationS: number) {
  return Array.from({ length: count }, (_, i) => ({
    km: i + 1,
    duration_s: durationS,
  }));
}

beforeEach(() => {
  listRuns.mockReset();
  listSavedRoutes.mockReset();
  listRuns.mockResolvedValue([]);
  listSavedRoutes.mockResolvedValue([]);
});

afterEach(cleanup);

describe("RunnerStats · lifetime totals", () => {
  it("shows totals derived from the run history", async () => {
    listRuns.mockResolvedValue([
      run({ distance_km: 5, duration_s: 1500, splits: splits(5, 300) }),
    ]);

    render(<RunnerStats />);

    const lifetime = await screen.findByRole("region", { name: "Lifetime totals" });
    expect(within(lifetime).getByText("5.0")).toBeTruthy();
    expect(within(lifetime).getByText("25m")).toBeTruthy();
    expect(within(lifetime).getByText("5:00")).toBeTruthy();
  });

  it("shows zeroes rather than an empty state before the first run", async () => {
    render(<RunnerStats />);

    const lifetime = await screen.findByRole("region", { name: "Lifetime totals" });
    expect(within(lifetime).getByText("0.0")).toBeTruthy();
    // Pace has nothing to average, so it reads as unknown rather than 0:00.
    expect(within(lifetime).getByText("—:—")).toBeTruthy();
  });

  it("reports a failure instead of rendering totals as zero", async () => {
    listRuns.mockRejectedValue(new Error("boom"));

    render(<RunnerStats />);

    expect(await screen.findByText(/couldn't load your totals/i)).toBeTruthy();
    // Crucially not the zero state — that would read as "you've never run".
    expect(screen.queryByText("0.0")).toBeNull();
  });
});

describe("RunnerStats · records", () => {
  it("lists distance-bracket records and links each to the run that set it", async () => {
    listRuns.mockResolvedValue([
      run({ id: "run-1", distance_km: 5, duration_s: 1500, splits: splits(5, 300) }),
    ]);

    render(<RunnerStats />);

    const records = await screen.findByRole("region", { name: "Personal bests" });
    expect(within(records).getByText("Fastest 1 km")).toBeTruthy();
    expect(within(records).getByText("Fastest 5 km")).toBeTruthy();
    // 5 splits x 300 s.
    expect(within(records).getByText("25:00")).toBeTruthy();

    for (const link of within(records).getAllByRole("link")) {
      expect(link.getAttribute("href")).toBe("/activity/run-1");
    }
  });

  it("omits brackets no run was long enough to set", async () => {
    listRuns.mockResolvedValue([
      run({ distance_km: 3, duration_s: 900, splits: splits(3, 300) }),
    ]);

    render(<RunnerStats />);

    const records = await screen.findByRole("region", { name: "Personal bests" });
    expect(within(records).getByText("Fastest 1 km")).toBeTruthy();
    expect(within(records).queryByText("Fastest 5 km")).toBeNull();
  });

  it("renders no records section at all with no runs", async () => {
    render(<RunnerStats />);

    await screen.findByRole("region", { name: "Lifetime totals" });
    expect(screen.queryByRole("region", { name: "Personal bests" })).toBeNull();
  });
});

describe("RunnerStats · route grades", () => {
  it("summarises the grades of saved routes", async () => {
    listSavedRoutes.mockResolvedValue([
      route({ id: "a", grade: "B", score: 80 }),
      route({ id: "b", grade: "B", score: 70 }),
      route({ id: "c", grade: "A", score: 95 }),
    ]);

    render(<RunnerStats />);

    const grades = await screen.findByRole("region", { name: "Route grades" });
    expect(within(grades).getByText(/Most of your routes grade B/)).toBeTruthy();
    expect(within(grades).getByText(/3 saved/)).toBeTruthy();
  });

  it("stays hidden when nothing is saved", async () => {
    render(<RunnerStats />);

    await screen.findByRole("region", { name: "Lifetime totals" });
    expect(screen.queryByRole("region", { name: "Route grades" })).toBeNull();
  });
});

describe("RunnerStats · independent loading", () => {
  it("still shows totals when saved routes fail", async () => {
    listRuns.mockResolvedValue([run({ distance_km: 5, duration_s: 1500 })]);
    listSavedRoutes.mockRejectedValue(new Error("boom"));

    render(<RunnerStats />);

    expect(await screen.findByText(/couldn't load your saved routes/i)).toBeTruthy();
    const lifetime = screen.getByRole("region", { name: "Lifetime totals" });
    expect(within(lifetime).getByText("5.0")).toBeTruthy();
  });

  it("still shows route grades when runs fail", async () => {
    listRuns.mockRejectedValue(new Error("boom"));
    listSavedRoutes.mockResolvedValue([route({ grade: "A", score: 95 })]);

    render(<RunnerStats />);

    expect(await screen.findByText(/couldn't load your totals/i)).toBeTruthy();
    const grades = screen.getByRole("region", { name: "Route grades" });
    expect(within(grades).getByText(/Most of your routes grade A/)).toBeTruthy();
  });
});
