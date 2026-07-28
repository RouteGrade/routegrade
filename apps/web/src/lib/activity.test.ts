import { describe, expect, it } from "vitest";
import {
  periodStart,
  runsWithin,
  summarizePeriod,
  summarizeRuns,
  summarizeSplits,
} from "./activity";
import type { RecordedRun } from "@/lib/api/runs-client";

function run(partial: Partial<RecordedRun>): RecordedRun {
  return {
    id: "r",
    route_id: null,
    route_name: null,
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

describe("summarizeRuns", () => {
  it("returns an empty summary with no pace for no runs", () => {
    expect(summarizeRuns([])).toEqual({
      runs: 0,
      distanceKm: 0,
      durationS: 0,
      avgPaceSPerKm: null,
    });
  });

  it("adds up distance, duration and count", () => {
    const totals = summarizeRuns([
      run({ distance_km: 5, duration_s: 1500 }),
      run({ distance_km: 2.5, duration_s: 900 }),
    ]);
    expect(totals.runs).toBe(2);
    expect(totals.distanceKm).toBeCloseTo(7.5);
    expect(totals.durationS).toBe(2400);
  });

  it("weights average pace by distance, not by run", () => {
    // 1 km at 10:00/km + 19 km at 5:00/km. A mean of the two runs' paces would
    // give 7:30/km; the honest distance-weighted answer is ~5:15/km.
    const totals = summarizeRuns([
      run({ distance_km: 1, duration_s: 600 }),
      run({ distance_km: 19, duration_s: 5700 }),
    ]);
    expect(totals.avgPaceSPerKm).toBe(Math.round(6300 / 20));
    expect(totals.avgPaceSPerKm).toBe(315);
  });

  it("does not divide by zero when every run recorded no distance", () => {
    const totals = summarizeRuns([run({ distance_km: 0, duration_s: 120 })]);
    expect(totals.avgPaceSPerKm).toBeNull();
    expect(totals.durationS).toBe(120);
  });
});

describe("periodStart", () => {
  // Local time throughout: a runner's "this week" is the one they lived.
  // 2026-07-29 is a Wednesday.
  const wednesday = new Date(2026, 6, 29, 14, 30);

  it("starts the week on the preceding Monday", () => {
    expect(periodStart("week", wednesday)).toEqual(new Date(2026, 6, 27));
  });

  it("treats Sunday as the end of its week, not the start of the next", () => {
    // 2026-08-02 is a Sunday; its week still began Monday 2026-07-27.
    const sunday = new Date(2026, 7, 2, 9, 0);
    expect(periodStart("week", sunday)).toEqual(new Date(2026, 6, 27));
  });

  it("starts the week on the same day when it is already Monday", () => {
    const monday = new Date(2026, 6, 27, 23, 59);
    expect(periodStart("week", monday)).toEqual(new Date(2026, 6, 27));
  });

  it("starts the month and the year on their first day", () => {
    expect(periodStart("month", wednesday)).toEqual(new Date(2026, 6, 1));
    expect(periodStart("year", wednesday)).toEqual(new Date(2026, 0, 1));
  });
});

describe("runsWithin", () => {
  const now = new Date(2026, 6, 29, 14, 30); // Wednesday

  it("keeps runs from the period and drops earlier ones", () => {
    const kept = run({ id: "monday", started_at: new Date(2026, 6, 27, 7).toISOString() });
    const dropped = run({ id: "last-week", started_at: new Date(2026, 6, 26, 7).toISOString() });
    expect(runsWithin([kept, dropped], "week", now).map((r) => r.id)).toEqual([
      "monday",
    ]);
  });

  it("widens as the period widens", () => {
    const runs = [
      run({ id: "today", started_at: new Date(2026, 6, 29, 6).toISOString() }),
      run({ id: "this-month", started_at: new Date(2026, 6, 3, 6).toISOString() }),
      run({ id: "this-year", started_at: new Date(2026, 1, 3, 6).toISOString() }),
      run({ id: "last-year", started_at: new Date(2025, 11, 3, 6).toISOString() }),
    ];
    expect(runsWithin(runs, "week", now)).toHaveLength(1);
    expect(runsWithin(runs, "month", now)).toHaveLength(2);
    expect(runsWithin(runs, "year", now)).toHaveLength(3);
  });

  it("drops a run whose start date cannot be parsed", () => {
    expect(runsWithin([run({ started_at: "not a date" })], "year", now)).toEqual(
      [],
    );
  });
});

describe("summarizePeriod", () => {
  const now = new Date(2026, 6, 29, 14, 30);

  it("totals only the runs inside the period", () => {
    const totals = summarizePeriod(
      [
        run({ started_at: new Date(2026, 6, 28, 7).toISOString(), distance_km: 10, duration_s: 3000 }),
        run({ started_at: new Date(2026, 5, 28, 7).toISOString(), distance_km: 42, duration_s: 15000 }),
      ],
      "week",
      now,
    );
    expect(totals.runs).toBe(1);
    expect(totals.distanceKm).toBeCloseTo(10);
  });

  it("reports an honest empty period rather than borrowing from a wider one", () => {
    const totals = summarizePeriod(
      [run({ started_at: new Date(2026, 0, 5, 7).toISOString(), distance_km: 10, duration_s: 3000 })],
      "week",
      now,
    );
    expect(totals).toEqual({
      runs: 0,
      distanceKm: 0,
      durationS: 0,
      avgPaceSPerKm: null,
    });
  });
});

describe("summarizeSplits", () => {
  it("returns nothing for no splits", () => {
    expect(summarizeSplits([])).toEqual({ rows: [], averageS: 0 });
  });

  it("drops splits with a non-positive or non-finite duration", () => {
    const { rows } = summarizeSplits([
      { km: 1, duration_s: 300 },
      { km: 2, duration_s: 0 },
      { km: 3, duration_s: Number.NaN },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].km).toBe(1);
  });

  it("measures each split as a signed deviation from the run's average", () => {
    const { rows, averageS } = summarizeSplits([
      { km: 1, duration_s: 300 },
      { km: 2, duration_s: 400 },
    ]);
    expect(averageS).toBe(350);
    expect(rows[0].deltaS).toBe(-50); // faster than average
    expect(rows[1].deltaS).toBe(50); // slower than average
  });

  it("scales magnitude against the largest deviation, so variation is visible", () => {
    // Absolute durations differ by only ~7%, which is invisible from a zero
    // baseline; as deviations they span the full width.
    const { rows } = summarizeSplits([
      { km: 1, duration_s: 290 },
      { km: 2, duration_s: 300 },
      { km: 3, duration_s: 310 },
    ]);
    expect(rows[0].magnitude).toBe(1);
    expect(rows[1].magnitude).toBe(0);
    expect(rows[2].magnitude).toBe(1);
  });

  it("gives every bar zero magnitude when all splits are identical", () => {
    const { rows } = summarizeSplits([
      { km: 1, duration_s: 300 },
      { km: 2, duration_s: 300 },
    ]);
    expect(rows.every((r) => r.magnitude === 0)).toBe(true);
    expect(rows.every((r) => r.deltaS === 0)).toBe(true);
  });

  it("marks exactly one fastest split, resolving ties to the earliest", () => {
    const { rows } = summarizeSplits([
      { km: 1, duration_s: 300 },
      { km: 2, duration_s: 300 },
      { km: 3, duration_s: 400 },
    ]);
    expect(rows.filter((r) => r.fastest)).toHaveLength(1);
    expect(rows[0].fastest).toBe(true);
  });

  it("marks no fastest split when there is nothing to compare against", () => {
    expect(summarizeSplits([{ km: 1, duration_s: 300 }]).rows[0].fastest).toBe(
      false,
    );
    const flat = summarizeSplits([
      { km: 1, duration_s: 300 },
      { km: 2, duration_s: 300 },
    ]);
    expect(flat.rows.some((r) => r.fastest)).toBe(false);
  });
});
