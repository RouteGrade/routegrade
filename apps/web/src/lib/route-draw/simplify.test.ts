import { describe, expect, it } from "vitest";
import { simplifyPath } from "./simplify";
import { buildDoc } from "./use-route-draw";
import type { Position } from "./types";
import type { RoutedSegment } from "@/lib/api/routes-client";

describe("simplifyPath (RDP)", () => {
  it("passes through 2 or fewer points", () => {
    const p: Position[] = [[0, 0], [1, 1]];
    expect(simplifyPath(p, 10)).toEqual(p);
  });

  it("collapses a nearly-straight run to its endpoints", () => {
    // A line east with tiny (<1 m) north jitter — all interior points are
    // within tolerance of the A→B chord, so only the endpoints survive.
    const pts: Position[] = [];
    for (let i = 0; i <= 20; i++) {
      pts.push([i * 0.001, (i % 2) * 0.000005]);
    }
    const out = simplifyPath(pts, 15);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    expect(out.length).toBeLessThan(pts.length);
    expect(out.length).toBe(2);
  });

  it("keeps a genuine corner", () => {
    // East for 5 points, then a sharp turn north — the corner must be kept.
    const pts: Position[] = [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
      [0.003, 0], // corner
      [0.003, 0.001],
      [0.003, 0.002],
    ];
    const out = simplifyPath(pts, 15);
    expect(out).toContainEqual([0.003, 0]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0.003, 0.002]);
  });
});

describe("buildDoc", () => {
  const seg = (coords: Position[], meters: number): RoutedSegment => ({
    geometry: { type: "LineString", coordinates: coords },
    distanceMeters: meters,
  });

  it("assembles waypoints + segments from routed pairs", () => {
    const verts: Position[] = [[0, 0], [1, 0], [2, 0]];
    const doc = buildDoc(verts, [
      seg([[0, 0.01], [0.5, 0.01], [1, 0.01]], 120), // snapped slightly north
      seg([[1, 0.01], [1.5, 0.01], [2, 0.01]], 130),
    ]);

    expect(doc.waypoints).toHaveLength(3);
    expect(doc.segments).toHaveLength(2);
    // Snapped positions come from the routed geometry endpoints.
    expect(doc.waypoints[0].snapped).toEqual([0, 0.01]);
    expect(doc.waypoints[1].snapped).toEqual([1, 0.01]);
    expect(doc.waypoints[2].snapped).toEqual([2, 0.01]);
    // Raw positions are the drawn vertices.
    expect(doc.waypoints.map((w) => w.raw)).toEqual(verts);
    // Segments link consecutive waypoints and carry distance.
    expect(doc.segments[0].startWaypointId).toBe(doc.waypoints[0].id);
    expect(doc.segments[0].endWaypointId).toBe(doc.waypoints[1].id);
    expect(doc.segments.map((s) => s.distanceMeters)).toEqual([120, 130]);
  });
});
