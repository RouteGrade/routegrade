import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatPace,
  haversineMeters,
  OFF_ROUTE_M,
  pathLengthMeters,
  projectOntoPath,
  spokenPace,
  type LngLat,
} from "./geo";

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    const p: LngLat = [-79.3832, 43.6532];
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("matches the known ~111.19 km per degree of latitude", () => {
    const a: LngLat = [-79.3832, 43.0];
    const b: LngLat = [-79.3832, 44.0];
    expect(haversineMeters(a, b)).toBeCloseTo(111_194.9, -2);
  });

  it("is symmetric", () => {
    const a: LngLat = [-79.3832, 43.6532];
    const b: LngLat = [-79.4, 43.66];
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe("pathLengthMeters", () => {
  it("is zero for fewer than two points", () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([[-79.3832, 43.6532]])).toBe(0);
  });

  it("sums consecutive segment distances", () => {
    const coords: LngLat[] = [
      [-79.3832, 43.6532],
      [-79.38, 43.6532],
      [-79.38, 43.656],
    ];
    const expected =
      haversineMeters(coords[0], coords[1]) + haversineMeters(coords[1], coords[2]);
    expect(pathLengthMeters(coords)).toBeCloseTo(expected, 6);
  });
});

describe("projectOntoPath", () => {
  // A straight east-west segment near Toronto's latitude, short enough that
  // the local equirectangular projection is effectively exact.
  const route: LngLat[] = [
    [-79.40, 43.65],
    [-79.30, 43.65],
  ];

  it("returns ~0 distance and the same point for a point on a vertex", () => {
    const { distanceToPathM, nearestPoint } = projectOntoPath(route[0], route);
    expect(distanceToPathM).toBeCloseTo(0, 3);
    expect(nearestPoint[0]).toBeCloseTo(route[0][0], 6);
    expect(nearestPoint[1]).toBeCloseTo(route[0][1], 6);
  });

  it("perpendicular offset from the segment midpoint projects straight down", () => {
    const midLng = (route[0][0] + route[1][0]) / 2;
    const offPoint: LngLat = [midLng, 43.651]; // ~111 m north of the line
    const { distanceToPathM, nearestPoint } = projectOntoPath(offPoint, route);
    expect(distanceToPathM).toBeGreaterThan(80);
    expect(distanceToPathM).toBeLessThan(140);
    expect(nearestPoint[0]).toBeCloseTo(midLng, 4);
    expect(nearestPoint[1]).toBeCloseTo(43.65, 4);
  });

  it("clamps the nearest point to the endpoint when beyond the path", () => {
    const beyondEnd: LngLat = [-79.2, 43.65];
    const { nearestPoint, alongPathM } = projectOntoPath(beyondEnd, route);
    expect(nearestPoint[0]).toBeCloseTo(route[1][0], 6);
    expect(alongPathM).toBeCloseTo(pathLengthMeters(route), 3);
  });

  it("alongPathM grows from ~0 at the start to the full length at the end", () => {
    const atStart = projectOntoPath(route[0], route);
    const atEnd = projectOntoPath(route[1], route);
    expect(atStart.alongPathM).toBeCloseTo(0, 3);
    expect(atEnd.alongPathM).toBeCloseTo(pathLengthMeters(route), 3);
  });

  it("flags a point past OFF_ROUTE_M as off-route, matching the camera-follow fix", () => {
    const midLng = (route[0][0] + route[1][0]) / 2;
    const nearby: LngLat = [midLng, 43.6505]; // ~55 m off — just over threshold
    const onRoute: LngLat = [midLng, 43.6501]; // ~11 m off — under threshold
    expect(projectOntoPath(nearby, route).distanceToPathM).toBeGreaterThan(OFF_ROUTE_M);
    expect(projectOntoPath(onRoute, route).distanceToPathM).toBeLessThan(OFF_ROUTE_M);
  });
});

describe("formatPace", () => {
  it("renders an em dash placeholder for null or non-finite input", () => {
    expect(formatPace(null)).toBe("—:—");
    expect(formatPace(0)).toBe("—:—");
    expect(formatPace(Number.NaN)).toBe("—:—");
  });

  it("formats seconds-per-km as m:ss", () => {
    expect(formatPace(342)).toBe("5:42");
    expect(formatPace(65)).toBe("1:05");
  });
});

describe("formatDuration", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("formats hour-plus durations as h:mm:ss", () => {
    expect(formatDuration(3727)).toBe("1:02:07");
  });
});

describe("spokenPace", () => {
  it("says minutes and seconds together", () => {
    expect(spokenPace(342)).toBe("5 minutes 42 seconds per kilometer");
  });

  it("drops the zero unit when minutes or seconds are exactly zero", () => {
    expect(spokenPace(45)).toBe("45 seconds per kilometer");
    expect(spokenPace(300)).toBe("5 minutes per kilometer");
  });
});
