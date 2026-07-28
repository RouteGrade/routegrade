import { describe, expect, it } from "vitest";
import { personalBests, summarizeRouteGrades } from "./profile";
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

describe("personalBests", () => {
  it("has no records without runs", () => {
    expect(personalBests([])).toEqual({
      longestDistanceKm: null,
      fastestPaceSPerKm: null,
      longestDurationS: null,
    });
  });

  it("picks the longest run, the longest time and the quickest pace", () => {
    const bests = personalBests([
      run({ id: "a", distance_km: 5, duration_s: 1500 }), // 5:00/km
      run({ id: "b", distance_km: 21.1, duration_s: 7000 }), // 5:32/km
      run({ id: "c", distance_km: 3, duration_s: 810 }), // 4:30/km
    ]);
    expect(bests.longestDistanceKm).toMatchObject({ runId: "b", value: 21.1 });
    expect(bests.longestDurationS).toMatchObject({ runId: "b", value: 7000 });
    expect(bests.fastestPaceSPerKm).toMatchObject({ runId: "c", value: 270 });
  });

  it("ignores sub-kilometre runs when setting the pace record", () => {
    // 200 m in 30 s is 2:30/km — a standing-start GPS artefact, not a record.
    const bests = personalBests([
      run({ id: "blip", distance_km: 0.2, duration_s: 30 }),
      run({ id: "real", distance_km: 10, duration_s: 3000 }),
    ]);
    expect(bests.fastestPaceSPerKm).toMatchObject({ runId: "real", value: 300 });
  });

  it("leaves the pace record unset when no run is long enough", () => {
    const bests = personalBests([run({ distance_km: 0.4, duration_s: 150 })]);
    expect(bests.fastestPaceSPerKm).toBeNull();
    // The distance record still stands — it has no minimum.
    expect(bests.longestDistanceKm?.value).toBe(0.4);
  });

  it("skips runs that recorded no distance or no time", () => {
    const bests = personalBests([
      run({ id: "abandoned", distance_km: 0, duration_s: 0 }),
    ]);
    expect(bests.longestDistanceKm).toBeNull();
    expect(bests.longestDurationS).toBeNull();
    expect(bests.fastestPaceSPerKm).toBeNull();
  });

  it("keeps the earlier run when two are tied", () => {
    const bests = personalBests([
      run({ id: "first", distance_km: 10, duration_s: 3000 }),
      run({ id: "second", distance_km: 10, duration_s: 3000 }),
    ]);
    expect(bests.longestDistanceKm?.runId).toBe("first");
    expect(bests.fastestPaceSPerKm?.runId).toBe("first");
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
