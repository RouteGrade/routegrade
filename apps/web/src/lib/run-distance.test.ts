import { describe, expect, it } from "vitest";
import { haversineMeters, type LngLat } from "./geo";
import {
  applyFix,
  initialDistanceState,
  MAX_ACCURACY_M,
  type DistanceState,
  type Fix,
} from "./run-distance";

/**
 * Founder bug report, 2026-07-28: "I just did a test run and the distance was
 * not correct."
 *
 * These tests pin the accumulator's behaviour, and the two named
 * "under-counted" cases are direct regression tests for the cause — see
 * `run-distance.ts` for why the anchor must not advance on a rejected fix.
 */

const START: LngLat = [-79.3832, 43.6532]; // Nathan Phillips Square
const METRES_PER_DEG_LAT = 111_320;

/** `metres` due north of `from` — good enough for accumulation tests. */
function northOf(from: LngLat, metres: number): LngLat {
  return [from[0], from[1] + metres / METRES_PER_DEG_LAT];
}

function feed(fixes: Fix[]): DistanceState {
  return fixes.reduce(
    (state, fix) => applyFix(state, fix).state,
    initialDistanceState(),
  );
}

/** A steady walker: one fix per second, `stepM` apart, at a given accuracy. */
function steadyRun(count: number, stepM: number, accuracyM: number): Fix[] {
  return Array.from({ length: count }, (_, i) => ({
    coord: northOf(START, i * stepM),
    accuracyM,
    timeMs: i * 1000,
  }));
}

describe("applyFix · basics", () => {
  it("anchors on the first trusted fix without adding distance", () => {
    const result = applyFix(initialDistanceState(), {
      coord: START,
      accuracyM: 8,
      timeMs: 0,
    });
    expect(result.verdict).toBe("anchored");
    expect(result.addedM).toBe(0);
    expect(result.state.distanceM).toBe(0);
    expect(result.state.anchor).not.toBeNull();
  });

  it("accumulates clean steps to the true straight-line distance", () => {
    // 3 m/s is a real running pace (~5:33/km). Deliberately not 10 m/s, which
    // sits exactly on the implausible-speed boundary and would make this test
    // pass or fail on a comparison operator rather than on the maths.
    const state = feed(steadyRun(10, 3, 8));
    expect(state.distanceM).toBeCloseTo(27, 0);
  });

  it("adds exactly the measured step, not an approximation of it", () => {
    const a = START;
    const b = northOf(START, 12);
    const state = feed([
      { coord: a, accuracyM: 5, timeMs: 0 },
      // 12 m over 3 s = 4 m/s. Over 1 s it would be 12 m/s — 43 km/h — and the
      // speed gate would rightly throw it out.
      { coord: b, accuracyM: 5, timeMs: 3000 },
    ]);
    expect(state.distanceM).toBeCloseTo(haversineMeters(a, b), 6);
  });
});

describe("applyFix · rejections keep the anchor put", () => {
  it("does not under-count a slow runner taking sub-threshold steps", () => {
    // THE REPORTED BUG. At 20 m accuracy the floor is 5 m, and this runner
    // covers 2 m per fix. Each individual step is below the floor, so the old
    // code rejected every one of them AND advanced the baseline behind each
    // rejection — recording 0 m for a run that really happened.
    //
    // Holding the anchor still lets the displacement grow: 2 m, 4 m, then 6 m,
    // which clears the floor and is counted in full.
    const state = feed(steadyRun(4, 2, 20));
    expect(state.distanceM).toBeCloseTo(6, 0);
  });

  it("keeps accumulating across a long slow stretch", () => {
    // 60 fixes at 2 m apart is 118 m of real travel. It is banked in 6 m
    // chunks, so the total lands within one chunk of the truth rather than at
    // zero.
    const state = feed(steadyRun(60, 2, 20));
    expect(state.distanceM).toBeGreaterThan(110);
    expect(state.distanceM).toBeLessThanOrEqual(118);
  });

  it("does not let an inaccurate fix become the reference point", () => {
    // A junk fix 500 m away lands between two good ones. It must be ignored
    // outright: if it became the anchor, the next good fix would measure a
    // ~500 m step back and either count it or trip the speed gate.
    const good1 = { coord: START, accuracyM: 5, timeMs: 0 };
    const junk = { coord: northOf(START, 500), accuracyM: 120, timeMs: 1000 };
    const good2 = { coord: northOf(START, 10), accuracyM: 5, timeMs: 2000 };

    const afterJunk = applyFix(applyFix(initialDistanceState(), good1).state, junk);
    expect(afterJunk.verdict).toBe("inaccurate");

    const state = applyFix(afterJunk.state, good2).state;
    expect(state.distanceM).toBeCloseTo(10, 0);
  });

  it("ignores a teleport glitch and measures the next fix from before it", () => {
    // 2 km in one second is not a runner. The glitch is dropped, and the fix
    // after it is measured against the last position we actually believed.
    const state = feed([
      { coord: START, accuracyM: 5, timeMs: 0 },
      { coord: northOf(START, 2000), accuracyM: 5, timeMs: 1000 },
      { coord: northOf(START, 8), accuracyM: 5, timeMs: 2000 },
    ]);
    expect(state.distanceM).toBeCloseTo(8, 0);
  });
});

describe("applyFix · does not invent distance", () => {
  it("stays at zero while a phone sits still and wobbles", () => {
    // Alternating ±2 m either side of one spot, which is what a stationary
    // handset looks like. Oscillation never grows, so it never clears the
    // floor — the property that makes holding the anchor safe.
    const fixes: Fix[] = Array.from({ length: 40 }, (_, i) => ({
      coord: northOf(START, i % 2 === 0 ? 0 : 2),
      accuracyM: 10,
      timeMs: i * 1000,
    }));
    expect(feed(fixes).distanceM).toBe(0);
  });

  it("refuses every fix worse than the accuracy gate", () => {
    const state = feed([
      { coord: START, accuracyM: MAX_ACCURACY_M + 1, timeMs: 0 },
      { coord: northOf(START, 50), accuracyM: MAX_ACCURACY_M + 1, timeMs: 1000 },
    ]);
    expect(state.distanceM).toBe(0);
    expect(state.anchor).toBeNull();
  });

  it("treats a non-finite accuracy as untrustworthy", () => {
    const result = applyFix(initialDistanceState(), {
      coord: START,
      accuracyM: Number.NaN,
      timeMs: 0,
    });
    expect(result.verdict).toBe("inaccurate");
    expect(result.state.anchor).toBeNull();
  });
});

describe("applyFix · a realistic 5 km run", () => {
  it("lands within a fraction of a percent of the true distance", () => {
    // 3 m/s, one fix per second, 5 m accuracy: 1667 fixes for 4998 m.
    const fixes = steadyRun(1667, 3, 5);
    const state = feed(fixes);
    const truth = haversineMeters(fixes[0].coord, fixes[fixes.length - 1].coord);

    expect(state.distanceM).toBeCloseTo(truth, 0);
    expect(Math.abs(state.distanceM - truth) / truth).toBeLessThan(0.001);
  });
});
