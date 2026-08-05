import type { Activity } from "@/lib/api/routes-client";
import { formatPace } from "@/lib/geo";

/**
 * How fast you were going, in the unit the activity is actually read in.
 *
 * Runners read minutes per kilometre; riders read kilometres per hour. They are
 * the same number inverted, but showing a ride as "2:24 /km" is close to
 * unreadable — nobody has an instinct for what a good bike pace is in min/km.
 *
 * Storage stays in seconds-per-kilometre for both (`runs.avg_pace_s_per_km`).
 * That is not a compromise: pace and speed are the same information, so the
 * database keeps one representation and the conversion lives here, at the point
 * of display. It also means slice 3's migration didn't need a second column.
 */

export type EffortMetric = {
  /** "Avg pace" / "Avg speed" — what to call it. */
  label: string;
  /** The figure, already formatted. "—:—" or "—" when unknown. */
  value: string;
  /** "/km" or "km/h". */
  unit: string;
};

/** km/h from seconds-per-km. Null in, null out; a non-positive pace is null. */
export function speedKmhFromPace(secondsPerKm: number | null): number | null {
  if (
    secondsPerKm === null ||
    !Number.isFinite(secondsPerKm) ||
    secondsPerKm <= 0
  ) {
    return null;
  }
  return 3600 / secondsPerKm;
}

/**
 * "24.6" — one decimal, which is the precision a bike computer shows and about
 * as much as GPS honestly supports.
 */
export function formatSpeed(kmh: number | null): string {
  if (kmh === null || !Number.isFinite(kmh) || kmh <= 0) return "—";
  return kmh.toFixed(1);
}

/** The rate figure for an activity, from the stored seconds-per-km. */
export function effortMetric(
  activity: Activity,
  secondsPerKm: number | null,
  { average = true }: { average?: boolean } = {},
): EffortMetric {
  if (activity === "ride") {
    return {
      label: average ? "Avg speed" : "Speed",
      value: formatSpeed(speedKmhFromPace(secondsPerKm)),
      unit: "km/h",
    };
  }
  return {
    label: average ? "Avg pace" : "Pace",
    value: formatPace(secondsPerKm),
    unit: "/km",
  };
}

/** Spoken form for an audio cue: "24.6 kilometers per hour". */
export function spokenSpeed(secondsPerKm: number): string {
  const kmh = speedKmhFromPace(secondsPerKm);
  if (kmh === null) return "";
  return `${kmh.toFixed(1)} kilometers per hour`;
}
