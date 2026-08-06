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

describe("applyFix · the run that was reported", () => {
  it("records a jog the old accumulator lost almost entirely", () => {
    // Run 2517eca4 in the runs table, 2026-07-28. The founder ran ~1 km; the
    // app stored 0.329 km. Its own saved GPS trace was 847.5 m long over just
    // 21 accepted points in 591 s of moving time — i.e. the trace knew about
    // ground the counter never added, which is the fingerprint of measuring
    // from a baseline that advances on rejected fixes.
    //
    // Profile reconstructed from that row: 591 s at ~1.7 m/s, 1 Hz fixes. The
    // smallest accepted step was 2.53 m, so the jitter floor was at its 2.5 m
    // minimum and accuracy was around 10 m. At 1.7 m per fix, every single
    // step falls under the floor.
    const fixes = steadyRun(591, 1.7, 10);
    const truth = haversineMeters(fixes[0].coord, fixes[fixes.length - 1].coord);

    const state = feed(fixes);

    expect(truth).toBeGreaterThan(990); // ~1 km, as reported
    expect(state.distanceM).toBeCloseTo(truth, 0);
    // The old accumulator returned 0.0 m for this exact profile.
    expect(state.distanceM).toBeGreaterThan(900);
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

describe("applyFix · rides", () => {
  /**
   * Founder request, 2026-08-05: biking alongside running. The speed guard was
   * sized for a runner (10 m/s = 36 km/h), which an ordinary bike descent
   * exceeds — so every fix of one was rejected as "implausible".
   *
   * These pin both halves: rides are believed at bike speeds, and runs are NOT
   * loosened along with them.
   */

  /** One fix per second at a constant speed, in m/s. */
  function atSpeed(count: number, mps: number): Fix[] {
    return Array.from({ length: count }, (_, i) => ({
      coord: northOf(START, i * mps),
      accuracyM: 8,
      timeMs: i * 1000,
    }));
  }

  function feedAs(fixes: Fix[], activity: "run" | "ride"): DistanceState {
    return fixes.reduce(
      (state, fix) => applyFix(state, fix, activity).state,
      initialDistanceState(),
    );
  }

  it("counts a 45 km/h descent as a ride", () => {
    // 12.5 m/s over 60 s = 750 m. The old constant recorded none of it.
    // Tolerance is 1%: `northOf` uses a flat degrees-to-metres constant while
    // the accumulator uses haversine, so they differ by ~0.1% over this span.
    const state = feedAs(atSpeed(61, 12.5), "ride");
    expect(state.distanceM).toBeGreaterThan(750 * 0.99);
    expect(state.distanceM).toBeLessThan(750 * 1.01);
  });

  it("is the regression: the same descent measured as a run loses almost all of it", () => {
    // Not an assertion about desired behaviour — it documents the bug being
    // fixed, and pins that a RUN still refuses to believe 45 km/h.
    const asRun = feedAs(atSpeed(61, 12.5), "run");
    const asRide = feedAs(atSpeed(61, 12.5), "ride");
    expect(asRun.distanceM).toBe(0);
    expect(asRide.distanceM).toBeGreaterThan(700);
  });

  it("still rejects a GPS teleport on a ride", () => {
    // 5 km in one second is ~5000 m/s — a glitch at any activity.
    const teleport: Fix[] = [
      { coord: START, accuracyM: 8, timeMs: 0 },
      { coord: northOf(START, 5000), accuracyM: 8, timeMs: 1000 },
    ];
    expect(feedAs(teleport, "ride").distanceM).toBe(0);
  });

  it("believes a fast descent but not an impossible one", () => {
    // 25 m/s (90 km/h) is a real descent; 35 m/s (126 km/h) is not a bicycle.
    expect(feedAs(atSpeed(11, 25), "ride").distanceM).toBeGreaterThan(0);
    expect(feedAs(atSpeed(11, 35), "ride").distanceM).toBe(0);
  });

  it("leaves ordinary riding — well under either cap — identical either way", () => {
    // 7 m/s is ~25 km/h, below the run cap too, so the split must not have
    // changed anything for speeds both activities already accepted.
    const fixes = atSpeed(31, 7);
    expect(feedAs(fixes, "ride").distanceM).toBeCloseTo(
      feedAs(fixes, "run").distanceM,
      6,
    );
  });

  it("defaults to run when no activity is passed", () => {
    // Every existing caller and every stored run must keep its behaviour.
    const fixes = atSpeed(61, 12.5);
    expect(feed(fixes).distanceM).toBe(feedAs(fixes, "run").distanceM);
  });

  it("does not loosen the jitter floor for rides — a parked bike stays at zero", () => {
    // A genuine wobble OSCILLATES around a point; it does not creep. (Steady
    // 1 m steps would rightly accumulate: the anchor holds through a rejection
    // precisely so slow real movement is deferred rather than discarded.)
    const parked: Fix[] = Array.from({ length: 40 }, (_, i) => ({
      coord: northOf(START, i % 2 === 0 ? 0 : 1.5),
      accuracyM: 8,
      timeMs: i * 1000,
    }));
    expect(feedAs(parked, "ride").distanceM).toBe(0);
    expect(feedAs(parked, "run").distanceM).toBe(0);
  });
});
