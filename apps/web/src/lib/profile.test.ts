import { describe, expect, it } from "vitest";
import { distanceRecords, personalBests, summarizeRouteGrades } from "./profile";
import type { RecordedRun } from "@/lib/api/runs-client";

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

/** `count` kilometre splits, each taking `durationS`, numbered from 1. */
function splits(count: number, durationS: number) {
  return Array.from({ length: count }, (_, i) => ({
    km: i + 1,
    duration_s: durationS,
  }));
}

describe("personalBests", () => {
  it("has no records without runs", () => {
    expect(personalBests([])).toEqual({
      longestDistanceKm: null,
      longestDurationS: null,
      longestRideKm: null,
    });
  });

  it("picks the longest run and the longest time", () => {
    const bests = personalBests([
      run({ id: "a", distance_km: 5, duration_s: 1500 }),
      run({ id: "b", distance_km: 21.1, duration_s: 7000 }),
      run({ id: "c", distance_km: 3, duration_s: 810 }),
    ]);
    expect(bests.longestDistanceKm).toMatchObject({ runId: "b", value: 21.1 });
    expect(bests.longestDurationS).toMatchObject({ runId: "b", value: 7000 });
  });

  it("tracks distance and time independently", () => {
    // A slow short run can hold the time record without holding the distance
    // record — they are not the same run.
    const bests = personalBests([
      run({ id: "far", distance_km: 12, duration_s: 3000 }),
      run({ id: "slow", distance_km: 6, duration_s: 5400 }),
    ]);
    expect(bests.longestDistanceKm?.runId).toBe("far");
    expect(bests.longestDurationS?.runId).toBe("slow");
  });

  it("skips runs that recorded no distance or no time", () => {
    const bests = personalBests([
      run({ id: "abandoned", distance_km: 0, duration_s: 0 }),
    ]);
    expect(bests.longestDistanceKm).toBeNull();
    expect(bests.longestDurationS).toBeNull();
  });

  it("keeps the earlier run when two are tied", () => {
    const bests = personalBests([
      run({ id: "first", distance_km: 10, duration_s: 3000 }),
      run({ id: "second", distance_km: 10, duration_s: 3000 }),
    ]);
    expect(bests.longestDistanceKm?.runId).toBe("first");
    expect(bests.longestDurationS?.runId).toBe("first");
  });

  it("carries the run id and date so a record can link to its run", () => {
    const bests = personalBests([
      run({ id: "run-1", started_at: "2026-05-02T06:00:00Z", distance_km: 8, duration_s: 2400 }),
    ]);
    expect(bests.longestDistanceKm).toEqual({
      runId: "run-1",
      startedAt: "2026-05-02T06:00:00Z",
      value: 8,
    });
  });
});

describe("distanceRecords", () => {
  it("returns nothing without runs", () => {
    expect(distanceRecords([])).toEqual([]);
  });

  it("omits brackets no run is long enough to set", () => {
    // Four kilometres sets the 1 km record but never reaches 5 km.
    const records = distanceRecords([run({ splits: splits(4, 300) })]);
    expect(records.map((r) => r.km)).toEqual([1]);
  });

  it("finds the quickest window rather than the first one", () => {
    const records = distanceRecords([
      run({
        id: "negative-split",
        splits: [
          { km: 1, duration_s: 320 },
          { km: 2, duration_s: 310 },
          { km: 3, duration_s: 280 },
        ],
      }),
    ]);
    expect(records).toEqual([
      expect.objectContaining({ km: 1, durationS: 280, runId: "negative-split" }),
    ]);
  });

  it("sums consecutive splits for the longer brackets", () => {
    const records = distanceRecords([run({ id: "steady", splits: splits(5, 300) })]);
    expect(records).toEqual([
      expect.objectContaining({ km: 1, durationS: 300 }),
      expect.objectContaining({ km: 5, durationS: 1500 }),
    ]);
  });

  it("takes the best bracket across different runs", () => {
    const records = distanceRecords([
      run({ id: "quick-5k", splits: splits(5, 280) }),
      run({ id: "long-slow", splits: splits(10, 330) }),
    ]);
    const byBracket = Object.fromEntries(records.map((r) => [r.km, r.runId]));
    expect(byBracket[5]).toBe("quick-5k");
    // Only the 10 km run reaches that bracket, even though it is slower.
    expect(byBracket[10]).toBe("long-slow");
  });

  it("will not span a gap in the split numbering", () => {
    // Kilometre 3 is missing, so no window of 5 covers a real 5 km.
    const records = distanceRecords([
      run({
        splits: [
          { km: 1, duration_s: 300 },
          { km: 2, duration_s: 300 },
          { km: 4, duration_s: 300 },
          { km: 5, duration_s: 300 },
          { km: 6, duration_s: 300 },
          { km: 7, duration_s: 300 },
        ],
      }),
    ]);
    // Six splits are present, but every window of five spans the missing
    // kilometre 3 and so covers 6 km of ground, not 5. No 5 km record stands.
    expect(records.map((r) => r.km)).toEqual([1]);
  });

  it("ignores splits with a non-positive or non-finite duration", () => {
    const records = distanceRecords([
      run({
        splits: [
          { km: 1, duration_s: 300 },
          { km: 2, duration_s: 0 },
          { km: 3, duration_s: Number.NaN },
        ],
      }),
    ]);
    expect(records).toEqual([expect.objectContaining({ km: 1, durationS: 300 })]);
  });

  it("keeps the earlier run when two share a bracket time", () => {
    const records = distanceRecords([
      run({ id: "first", splits: splits(1, 300) }),
      run({ id: "second", splits: splits(1, 300) }),
    ]);
    expect(records[0].runId).toBe("first");
  });
});

describe("summarizeRouteGrades", () => {
  it("reports an empty profile with no saved routes", () => {
    expect(summarizeRouteGrades([])).toEqual({
      routes: 0,
      counts: { A: 0, B: 0, C: 0, D: 0 },
      averageScore: null,
      commonestGrade: null,
    });
  });

  it("counts every grade and averages the scores", () => {
    const profile = summarizeRouteGrades([
      { grade: "A", score: 90 },
      { grade: "B", score: 80 },
      { grade: "B", score: 70 },
    ]);
    expect(profile.routes).toBe(3);
    expect(profile.counts).toEqual({ A: 1, B: 2, C: 0, D: 0 });
    expect(profile.averageScore).toBeCloseTo(80);
    expect(profile.commonestGrade).toBe("B");
  });

  it("breaks a tie toward the better grade", () => {
    const profile = summarizeRouteGrades([
      { grade: "C", score: 50 },
      { grade: "A", score: 95 },
    ]);
    expect(profile.commonestGrade).toBe("A");
  });
});

describe("records with rides mixed in", () => {
  /**
   * Founder request, 2026-08-05. The failure this guards: one afternoon ride
   * takes every running record permanently, and the board stops describing the
   * runner at all.
   */

  it("does not let a ride set the longest-distance running record", () => {
    const bests = personalBests([
      run({ id: "ran", distance_km: 12, duration_s: 3600 }),
      run({ id: "rode", activity: "ride", distance_km: 80, duration_s: 10800 }),
    ]);

    expect(bests.longestDistanceKm?.runId).toBe("ran");
    expect(bests.longestDistanceKm?.value).toBe(12);
  });

  it("reports the longest ride as its own record rather than dropping it", () => {
    const bests = personalBests([
      run({ id: "rode", activity: "ride", distance_km: 80, duration_s: 10800 }),
    ]);

    expect(bests.longestRideKm?.value).toBe(80);
    // ...and it is not silently doubling as a running record.
    expect(bests.longestDistanceKm).toBeNull();
  });

  it("does not let a ride take a distance-bracket record", () => {
    const splits = (n: number, each: number) =>
      Array.from({ length: n }, (_, i) => ({ km: i + 1, duration_s: each }));

    const records = distanceRecords([
      run({ id: "ran", splits: splits(5, 300) }), // 5:00/km
      run({ id: "rode", activity: "ride", splits: splits(5, 90) }), // 1:30/km
    ]);

    const fiveK = records.find((r) => r.km === 5);
    expect(fiveK?.runId).toBe("ran");
    expect(fiveK?.durationS).toBe(1500);
  });

  it("leaves the board empty rather than filling it from rides", () => {
    const records = distanceRecords([
      run({
        id: "rode",
        activity: "ride",
        splits: Array.from({ length: 10 }, (_, i) => ({ km: i + 1, duration_s: 90 })),
      }),
    ]);
    expect(records).toEqual([]);
  });
});
