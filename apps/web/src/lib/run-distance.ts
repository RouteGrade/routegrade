import { haversineMeters, type LngLat } from "@/lib/geo";

/**
 * Distance accumulation for a live run.
 *
 * Extracted from `run-tracker.tsx` so it can be tested: this is the number the
 * whole app is judged on, and it was previously buried in a React ref inside a
 * GPS callback, reachable only by going for an actual run.
 *
 * The rule that matters: **the anchor only ever advances on an accepted fix.**
 * A rejected fix must not become the reference point for the next one.
 *
 * That is not a detail — it is the whole reason the filter works. Displacement
 * measured from a fixed anchor *grows* when someone is really moving and merely
 * *oscillates* when a stationary phone's GPS wobbles. Keeping the anchor put
 * preserves that difference, so a slow runner's small steps accumulate until
 * they clear the threshold and get counted. Advancing the anchor on a rejection
 * destroys it: every sub-threshold step is discarded AND the baseline moves up
 * behind it, so the distance is gone for good rather than deferred.
 */

// GPS quality gates. A fix worse than this is not trusted for distance at all.
export const MAX_ACCURACY_M = 60;
// Floor for a step to count, so a still phone doesn't tick metres up.
export const MIN_STEP_M = 2.5;
/**
 * Above this, treat the jump as a fix glitch rather than a human.
 *
 * 10 m/s is 36 km/h — past any runner, so it only ever catches glitches on a
 * run. On a BIKE it is inside the normal range: 36 km/h is an ordinary descent,
 * and this guard would reject every fix of one. That is not a deferral. The
 * anchor deliberately does not advance on a rejection, so the ride keeps being
 * measured from a stale anchor and, when it finally slows enough to be
 * believed, only the straight-line CHORD from that anchor is counted. On a
 * switchback descent the chord is a fraction of the road, and the rest is gone.
 *
 * So the cap is per-activity. See `maxSpeedMpsFor`.
 */
export const MAX_SPEED_MPS = 10;

/**
 * The same guard for a ride: 30 m/s is 108 km/h, past a bike descent that
 * isn't a crash, and still orders of magnitude below a GPS teleport (those
 * arrive as hundreds or thousands of m/s, which this still rejects).
 */
export const MAX_RIDE_SPEED_MPS = 30;

/**
 * The speed ceiling for an activity.
 *
 * Only the speed guard needed splitting. Worth stating, because the obvious
 * suspicion was the other one: the jitter floor is `max(2.5 m, accuracy / 4)`,
 * and a rider covers 7+ m between one-second fixes against a runner's 2-3, so
 * a bike clears that floor MORE easily than a run, not less. It needs no
 * change, and loosening it "for bikes" would only make a parked bike accrue
 * phantom metres.
 */
export function maxSpeedMpsFor(activity: "run" | "ride"): number {
  return activity === "ride" ? MAX_RIDE_SPEED_MPS : MAX_SPEED_MPS;
}

export type Fix = {
  coord: LngLat;
  accuracyM: number;
  /**
   * When the device took the reading, in ms. Any clock will do as long as
   * every fix in a run comes from the same one and never goes backwards —
   * the tracker feeds it `LocationFix.timestampMs` so buffered background
   * fixes keep the spacing they were recorded with.
   */
  timeMs: number;
};

export type DistanceState = {
  distanceM: number;
  /** The last ACCEPTED fix. Rejected fixes never land here. */
  anchor: { coord: LngLat; timeMs: number } | null;
};

export type FixVerdict =
  /** First trusted fix — nothing to measure from yet. */
  | "anchored"
  | "counted"
  /** Fix too imprecise to trust. */
  | "inaccurate"
  /** Moved too little to distinguish from GPS wobble — deferred, not discarded. */
  | "jitter"
  /** Implied a speed no runner reaches; treated as a fix glitch. */
  | "implausible";

export type FixResult = {
  state: DistanceState;
  verdict: FixVerdict;
  /** Metres added by this fix; 0 unless the verdict is "counted". */
  addedM: number;
};

export function initialDistanceState(): DistanceState {
  return { distanceM: 0, anchor: null };
}

/**
 * Fold one position fix into the running total. Pure — returns a new state.
 *
 * `activity` defaults to "run", so every existing caller and every stored run
 * keeps exactly the behaviour it had.
 */
export function applyFix(
  state: DistanceState,
  fix: Fix,
  activity: "run" | "ride" = "run",
): FixResult {
  const maxSpeedMps = maxSpeedMpsFor(activity);
  if (!Number.isFinite(fix.accuracyM) || fix.accuracyM > MAX_ACCURACY_M) {
    return { state, verdict: "inaccurate", addedM: 0 };
  }

  if (state.anchor === null) {
    return {
      state: { ...state, anchor: { coord: fix.coord, timeMs: fix.timeMs } },
      verdict: "anchored",
      addedM: 0,
    };
  }

  const stepM = haversineMeters(state.anchor.coord, fix.coord);
  const dtS = (fix.timeMs - state.anchor.timeMs) / 1000;

  // Checked before the jitter floor: a teleport is a big step, a wobble is a
  // small one, so the two tests never contend for the same fix.
  if (dtS > 0 && stepM / dtS > maxSpeedMps) {
    return { state, verdict: "implausible", addedM: 0 };
  }

  // Scales with the fix's own accuracy — a ±40 m fix has to move further to be
  // believed than a ±5 m one.
  if (stepM < Math.max(MIN_STEP_M, fix.accuracyM * 0.25)) {
    return { state, verdict: "jitter", addedM: 0 };
  }

  return {
    state: {
      distanceM: state.distanceM + stepM,
      anchor: { coord: fix.coord, timeMs: fix.timeMs },
    },
    verdict: "counted",
    addedM: stepM,
  };
}
