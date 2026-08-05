import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISTANCE_KM,
  activityCopy,
  distanceAfterActivityChange,
} from "./activity-type";
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
