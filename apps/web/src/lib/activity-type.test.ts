import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISTANCE_KM,
  activityCopy,
  activityOf,
  distanceAfterActivityChange,
  filterByActivity,
  hasMixedActivities,
} from "./activity-type";
import type { Activity } from "@/lib/api/routes-client";
import { DISTANCE_STEPS_KM } from "./distance-scale";

/**
 * Founder request, 2026-08-05: biking alongside running. This is slice 2 — the
 * activity type itself.
 */

describe("activityCopy", () => {
  it("says ride, not run, for a ride", () => {
    expect(activityCopy("ride").sheetTitle).toBe("Your ride");
    expect(activityCopy("ride").startLabel).toBe("Start ride");
  });

  it("leaves the running copy exactly as it was", () => {
    expect(activityCopy("run").sheetTitle).toBe("Your run");
    expect(activityCopy("run").startLabel).toBe("Start run");
  });
});

describe("default distances", () => {
  it("are both reachable on the slider", () => {
    // A default the slider can't land on would leave the thumb and the readout
    // disagreeing the moment the screen opens.
    expect(DISTANCE_STEPS_KM).toContain(DEFAULT_DISTANCE_KM.run);
    expect(DISTANCE_STEPS_KM).toContain(DEFAULT_DISTANCE_KM.ride);
  });

  it("make a ride longer than a run", () => {
    expect(DEFAULT_DISTANCE_KM.ride).toBeGreaterThan(DEFAULT_DISTANCE_KM.run);
  });
});

describe("distanceAfterActivityChange", () => {
  it("offers a ride-shaped distance when the run distance was untouched", () => {
    expect(distanceAfterActivityChange("run", "ride", DEFAULT_DISTANCE_KM.run)).toBe(
      DEFAULT_DISTANCE_KM.ride,
    );
  });

  it("keeps a distance the user actually chose", () => {
    // The case that matters: picking 8 km and then switching activity must not
    // quietly throw the 8 away.
    expect(distanceAfterActivityChange("run", "ride", 8)).toBe(8);
    expect(distanceAfterActivityChange("ride", "run", 65)).toBe(65);
  });

  it("comes back to the run default when the ride distance was untouched", () => {
    expect(distanceAfterActivityChange("ride", "run", DEFAULT_DISTANCE_KM.ride)).toBe(
      DEFAULT_DISTANCE_KM.run,
    );
  });

  it("does nothing when the activity hasn't changed", () => {
    expect(distanceAfterActivityChange("run", "run", DEFAULT_DISTANCE_KM.run)).toBe(
      DEFAULT_DISTANCE_KM.run,
    );
    expect(distanceAfterActivityChange("ride", "ride", 42)).toBe(42);
  });
});

/**
 * Splitting stored records by activity — what the Routes tab filters on.
 *
 * The legacy cases carry the weight here. Migration 0008 backfilled every
 * pre-existing row to 'run', but a route saved by an older client, or read back
 * from a response that predates the column, arrives with no activity at all.
 * Those genuinely were runs, and reading them as anything else would file a
 * runner's whole library under Ride the first time they own a bike.
 */
describe("activityOf", () => {
  it("reads a stored activity straight through", () => {
    expect(activityOf({ activity: "run" })).toBe("run");
    expect(activityOf({ activity: "ride" })).toBe("ride");
  });

  it("reads a record with no activity as a run", () => {
    expect(activityOf({})).toBe("run");
    expect(activityOf({ activity: null })).toBe("run");
    expect(activityOf({ activity: undefined })).toBe("run");
  });
});

describe("filterByActivity", () => {
  const routes = [
    { id: "a", activity: "run" as const },
    { id: "b", activity: "ride" as const },
    { id: "c", activity: "run" as const },
  ];

  it("passes everything through on 'all'", () => {
    expect(filterByActivity(routes, "all")).toEqual(routes);
  });

  it("keeps only the chosen activity", () => {
    expect(filterByActivity(routes, "run").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterByActivity(routes, "ride").map((r) => r.id)).toEqual(["b"]);
  });

  it("files a legacy route with no activity under Run", () => {
    // Shaped like a route read back from before the column existed: the field
    // is genuinely absent, not null.
    const legacy: { id: string; activity?: Activity }[] = [{ id: "old" }];
    expect(filterByActivity(legacy, "run")).toHaveLength(1);
    expect(filterByActivity(legacy, "ride")).toHaveLength(0);
  });

  it("preserves the order it was given", () => {
    // The list is sorted newest-first server-side; filtering must not reshuffle.
    expect(filterByActivity(routes, "run")).toEqual([routes[0], routes[2]]);
  });
});

describe("hasMixedActivities", () => {
  it("is false until there is something on both sides", () => {
    expect(hasMixedActivities([])).toBe(false);
    expect(hasMixedActivities([{ activity: "run" }])).toBe(false);
    expect(hasMixedActivities([{ activity: "ride" }, { activity: "ride" }])).toBe(
      false,
    );
  });

  it("is true once both activities are saved", () => {
    expect(hasMixedActivities([{ activity: "run" }, { activity: "ride" }])).toBe(
      true,
    );
  });

  it("counts a legacy route as the run side of the mix", () => {
    const mixed: { activity?: Activity }[] = [{}, { activity: "ride" }];
    expect(hasMixedActivities(mixed)).toBe(true);
  });
});
