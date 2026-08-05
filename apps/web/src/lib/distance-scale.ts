/**
 * The ladder of distances the planner's slider can select.
 *
 * The slider now reaches 100 km so it covers a bike ride as well as a run, but
 * a plain 1-100 km range would make the distances people actually pick
 * unreachable on a phone: at half-kilometre precision the whole 5-10 km band
 * sits under a fingertip, and choosing 5.0 rather than 4.7 becomes a two-pixel
 * problem. So the slider indexes into this ladder instead of holding kilometres
 * directly — fine control where half a kilometre changes the run, coarser steps
 * out where it doesn't.
 *
 *   1-20 km   in 0.5 km steps   (the running range)
 *   20-30 km  in 1 km steps
 *   30-50 km  in 2 km steps
 *   50-100 km in 5 km steps     (the riding range)
 *
 * Kept as a pure module so the ladder can be tested directly and reused by the
 * planner, the saved-route restore path, and the e2e suite without any of them
 * re-deriving it.
 */

function band(from: number, to: number, step: number): number[] {
  const values: number[] = [];
  // Exclusive of `from` so adjoining bands don't repeat their shared boundary.
  for (let km = from + step; km <= to + 1e-9; km += step) {
    values.push(Math.round(km * 10) / 10);
  }
  return values;
}

export const DISTANCE_STEPS_KM: readonly number[] = [
  1,
  ...band(1, 20, 0.5),
  ...band(20, 30, 1),
  ...band(30, 50, 2),
  ...band(50, 100, 5),
];

export const MIN_DISTANCE_KM = DISTANCE_STEPS_KM[0];
export const MAX_DISTANCE_KM = DISTANCE_STEPS_KM[DISTANCE_STEPS_KM.length - 1];
export const MAX_STEP_INDEX = DISTANCE_STEPS_KM.length - 1;

/** The kilometres at a slider position, clamped to the ends of the ladder. */
export function distanceForStepIndex(index: number): number {
  const clamped = Math.min(MAX_STEP_INDEX, Math.max(0, Math.round(index)));
  return DISTANCE_STEPS_KM[clamped];
}

/**
 * The slider position closest to a given distance. Ties go to the shorter of
 * the two neighbours, so a distance landing exactly between steps never
 * silently inflates.
 */
export function stepIndexForDistance(km: number): number {
  let bestIndex = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < DISTANCE_STEPS_KM.length; i += 1) {
    const delta = Math.abs(DISTANCE_STEPS_KM[i] - km);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Snap an arbitrary distance onto the ladder. Used when a distance arrives from
 * outside the slider — restoring a saved route, say — so the slider thumb and
 * the readout can never disagree.
 */
export function snapDistanceKm(km: number): number {
  return DISTANCE_STEPS_KM[stepIndexForDistance(km)];
}

/**
 * Distances read as "7.5 km" but "60 km" — past the half-kilometre band every
 * step is a whole number, and a trailing ".0" there is just noise in 72px type.
 */
export function formatDistanceKm(km: number): string {
  return Number.isInteger(km) && km > 20 ? String(km) : km.toFixed(1);
}
