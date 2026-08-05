import { describe, expect, it } from "vitest";
import {
  effortMetric,
  formatSpeed,
  speedKmhFromPace,
  spokenSpeed,
} from "./effort-metric";

/**
 * Founder request, 2026-08-05. A ride shown as "2:24 /km" is technically
 * correct and practically unreadable — nobody has an instinct for a good bike
 * pace in minutes per kilometre.
 */

describe("speedKmhFromPace", () => {
  it("inverts a pace into km/h", () => {
    expect(speedKmhFromPace(300)).toBeCloseTo(12, 5); // 5:00/km
    expect(speedKmhFromPace(144)).toBeCloseTo(25, 5); // 2:24/km
  });

  it("returns null for anything that isn't a usable pace", () => {
    expect(speedKmhFromPace(null)).toBeNull();
    expect(speedKmhFromPace(0)).toBeNull();
    expect(speedKmhFromPace(-30)).toBeNull();
    expect(speedKmhFromPace(Number.NaN)).toBeNull();
  });

  it("round-trips: a speed converted back is the original pace", () => {
    const pace = 144;
    expect(3600 / speedKmhFromPace(pace)!).toBeCloseTo(pace, 5);
  });
});

describe("formatSpeed", () => {
  it("shows one decimal, the precision a bike computer shows", () => {
    expect(formatSpeed(25)).toBe("25.0");
    expect(formatSpeed(24.63)).toBe("24.6");
  });

  it("shows a dash rather than a fake zero when unknown", () => {
    expect(formatSpeed(null)).toBe("—");
    expect(formatSpeed(0)).toBe("—");
  });
});

describe("effortMetric", () => {
  it("gives a run a pace in min/km", () => {
    expect(effortMetric("run", 300)).toEqual({
      label: "Avg pace",
      value: "5:00",
      unit: "/km",
    });
  });

  it("gives a ride a speed in km/h", () => {
    expect(effortMetric("ride", 144)).toEqual({
      label: "Avg speed",
      value: "25.0",
      unit: "km/h",
    });
  });

  it("drops the Avg prefix for a live figure", () => {
    expect(effortMetric("run", 300, { average: false }).label).toBe("Pace");
    expect(effortMetric("ride", 144, { average: false }).label).toBe("Speed");
  });

  it("degrades to a placeholder rather than throwing on unknown input", () => {
    expect(effortMetric("run", null).value).toBe("—:—");
    expect(effortMetric("ride", null).value).toBe("—");
  });
});

describe("spokenSpeed", () => {
  it("reads a speed out loud in full words", () => {
    expect(spokenSpeed(144)).toBe("25.0 kilometers per hour");
  });

  it("says nothing rather than something wrong when the pace is unusable", () => {
    expect(spokenSpeed(0)).toBe("");
  });
});
