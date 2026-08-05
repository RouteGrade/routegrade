import { describe, expect, it } from "vitest";
import {
  DISTANCE_STEPS_KM,
  MAX_DISTANCE_KM,
  MAX_STEP_INDEX,
  MIN_DISTANCE_KM,
  distanceForStepIndex,
  formatDistanceKm,
  snapDistanceKm,
  stepIndexForDistance,
} from "./distance-scale";

/**
 * Founder request, 2026-08-05: raise the route length ceiling from 15 km to
 * 100 km so the planner can plan a ride, not just a run.
 *
 * The ladder these tests pin is what keeps that reach from wrecking the phone
 * UX — see `distance-scale.ts` for why the slider indexes into steps instead of
 * holding kilometres.
 */

describe("the distance ladder", () => {
  it("spans 1 km to 100 km", () => {
    expect(MIN_DISTANCE_KM).toBe(1);
    expect(MAX_DISTANCE_KM).toBe(100);
  });

  it("increases strictly, with no repeated band boundaries", () => {
    for (let i = 1; i < DISTANCE_STEPS_KM.length; i += 1) {
      expect(DISTANCE_STEPS_KM[i]).toBeGreaterThan(DISTANCE_STEPS_KM[i - 1]);
    }
  });

  it("has no floating-point noise in its values", () => {
    for (const km of DISTANCE_STEPS_KM) {
      expect(km).toBe(Math.round(km * 10) / 10);
    }
  });

  it("keeps half-kilometre precision across the running range", () => {
    // The band people actually pick from: every 0.5 must be reachable exactly.
    for (let km = 1; km <= 20; km += 0.5) {
      expect(DISTANCE_STEPS_KM).toContain(km);
    }
  });

  it("covers the common race distances exactly", () => {
    for (const km of [5, 10, 21, 42]) {
      expect(snapDistanceKm(km)).toBe(km);
    }
  });

  it("stays short enough to drag on a phone", () => {
    // A ~340px slider over this many steps still gives each step several pixels;
    // a linear 0.5 km ladder to 100 km would be 199 steps and unusable.
    expect(DISTANCE_STEPS_KM.length).toBeLessThan(80);
  });
});

describe("distanceForStepIndex", () => {
  it("maps the ends of the slider to the ends of the range", () => {
    expect(distanceForStepIndex(0)).toBe(1);
    expect(distanceForStepIndex(MAX_STEP_INDEX)).toBe(100);
  });

  it("clamps out-of-range positions instead of returning undefined", () => {
    expect(distanceForStepIndex(-5)).toBe(MIN_DISTANCE_KM);
    expect(distanceForStepIndex(9999)).toBe(MAX_DISTANCE_KM);
  });

  it("round-trips with stepIndexForDistance", () => {
    for (let i = 0; i <= MAX_STEP_INDEX; i += 1) {
      expect(stepIndexForDistance(distanceForStepIndex(i))).toBe(i);
    }
  });
});

describe("snapDistanceKm", () => {
  it("clamps distances beyond either end of the ladder", () => {
    expect(snapDistanceKm(0.2)).toBe(1);
    expect(snapDistanceKm(250)).toBe(100);
  });

  it("snaps a distance that falls between steps to the nearest one", () => {
    expect(snapDistanceKm(7.3)).toBe(7.5);
    expect(snapDistanceKm(7.1)).toBe(7);
    expect(snapDistanceKm(63)).toBe(65);
  });

  it("rounds a dead-centre distance down rather than up", () => {
    // 52.5 sits exactly between 50 and 55; overshooting a requested distance is
    // the worse of the two errors, so ties go short.
    expect(snapDistanceKm(52.5)).toBe(50);
  });

  it("is idempotent", () => {
    for (const km of [3.7, 22.4, 47, 88.2]) {
      expect(snapDistanceKm(snapDistanceKm(km))).toBe(snapDistanceKm(km));
    }
  });
});

describe("formatDistanceKm", () => {
  it("keeps one decimal in the half-kilometre range", () => {
    expect(formatDistanceKm(5)).toBe("5.0");
    expect(formatDistanceKm(7.5)).toBe("7.5");
    expect(formatDistanceKm(20)).toBe("20.0");
  });

  it("drops the trailing zero past the half-kilometre range", () => {
    expect(formatDistanceKm(24)).toBe("24");
    expect(formatDistanceKm(100)).toBe("100");
  });
});
