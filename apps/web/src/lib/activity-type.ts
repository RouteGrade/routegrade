import type { Activity } from "@/lib/api/routes-client";
import { snapDistanceKm } from "@/lib/distance-scale";

/**
 * What changes when a route is for a ride rather than a run.
 *
 * Kept in one place because "run" is a word the UI says constantly — in the
 * sheet header, on the start button, in aria labels — and a Ride that still
 * says "Your run" reads as a bug. Copy and defaults are data here, not
 * conditionals scattered through the components.
 *
 * Deliberately NOT here: pace vs speed formatting, and anything about stored
 * history. Both need the activity to be persisted on a run before they can be
 * right, which is a later slice.
 */

export type ActivityCopy = {
  /** "run" / "ride" — the noun, for interpolating into sentences. */
  noun: string;
  /** Title case, for headings: "Your run". */
  sheetTitle: string;
  /** The primary action on a chosen route. */
  startLabel: string;
  /** Label on the segmented control. */
  toggleLabel: string;
};

const COPY: Record<Activity, ActivityCopy> = {
  run: {
    noun: "run",
    sheetTitle: "Your run",
    startLabel: "Start run",
    toggleLabel: "Run",
  },
  ride: {
    noun: "ride",
    sheetTitle: "Your ride",
    startLabel: "Start ride",
    toggleLabel: "Ride",
  },
};

export function activityCopy(activity: Activity): ActivityCopy {
  return COPY[activity];
}

/**
 * The activity of a stored record, tolerant of not having one.
 *
 * Anything saved before migration 0008 has no `activity` at all, and anything
 * saved between the API shipping and that migration landing may have been
 * written by a client that didn't send one. Both genuinely predate riding, so
 * reading them as a run is a statement of fact rather than a guess — but it has
 * to be one function, because `?? "run"` scattered across call sites is exactly
 * how one of them ends up being `?? "ride"`.
 */
export function activityOf(record: { activity?: Activity | null }): Activity {
  return record.activity === "ride" ? "ride" : "run";
}

/** The saved-routes filter: either activity, or neither restriction. */
export const ACTIVITY_FILTERS = ["all", "run", "ride"] as const;

export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export const ACTIVITY_FILTER_LABEL: Record<ActivityFilter, string> = {
  all: "All",
  run: "Run",
  ride: "Ride",
};

/** Records matching the filter. "all" passes everything through untouched. */
export function filterByActivity<T extends { activity?: Activity | null }>(
  records: T[],
  filter: ActivityFilter,
): T[] {
  if (filter === "all") return records;
  return records.filter((record) => activityOf(record) === filter);
}

/**
 * Whether the filter is worth showing at all.
 *
 * A runner who has never saved a ride should not be asked to choose between run
 * and ride — the control would be three buttons where two of them do nothing,
 * and it would imply the app is hiding something from them. It appears the
 * moment the second activity does.
 */
export function hasMixedActivities(
  records: { activity?: Activity | null }[],
): boolean {
  let sawRun = false;
  let sawRide = false;
  for (const record of records) {
    if (activityOf(record) === "ride") sawRide = true;
    else sawRun = true;
    if (sawRun && sawRide) return true;
  }
  return false;
}

/**
 * Where the distance slider starts for each activity. 5 km is the long-standing
 * running default; 20 km is a short ride — far enough that the ride ceiling is
 * worth having, close enough that the first tap isn't a two-hour commitment.
 */
export const DEFAULT_DISTANCE_KM: Record<Activity, number> = {
  run: 5,
  ride: 20,
};

/**
 * The distance to show after switching activity.
 *
 * Only moves the distance if the user hadn't chosen one — switching to Ride
 * while still on the untouched 5 km default should offer a ride-shaped
 * distance, but switching after deliberately picking 8 km must not silently
 * discard that. Anything the user actually set is theirs to keep.
 */
export function distanceAfterActivityChange(
  from: Activity,
  to: Activity,
  currentKm: number,
): number {
  if (from === to) return currentKm;
  if (currentKm !== DEFAULT_DISTANCE_KM[from]) return currentKm;
  return snapDistanceKm(DEFAULT_DISTANCE_KM[to]);
}
