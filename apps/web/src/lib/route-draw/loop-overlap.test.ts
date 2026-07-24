import { describe, expect, it } from "vitest";
import { leastOverlappingIndex, overlapFraction } from "./loop-overlap";
import type { Position } from "./types";

const M = 1 / 111_320; // ~metres per degree of latitude

describe("overlapFraction", () => {
  it("is 1 when the candidate retraces the used path exactly", () => {
    const path: Position[] = [[0, 0], [0, 10 * M], [0, 20 * M]];
    expect(overlapFraction(path, path, 25)).toBe(1);
  });

  it("is ~0 when the candidate is far from the used path", () => {
    const used: Position[] = [[0, 0], [0, 10 * M]];
    const far: Position[] = [[0.01, 0.01], [0.01, 0.0101]];
    expect(overlapFraction(far, used, 25)).toBe(0);
  });
});

describe("leastOverlappingIndex", () => {
  it("picks the return leg that retraces the outbound least", () => {
    const outbound: Position[] = [[0, 0], [0, 100 * M], [0, 200 * M]];
    const retrace = outbound; // same street back — high overlap
    const detour: Position[] = [
      [0, 200 * M],
      [50 * M, 100 * M], // a parallel street ~50 m east
      [0, 0],
    ];
    expect(leastOverlappingIndex([retrace, detour], outbound, 25)).toBe(1);
  });

  it("returns 0 for a single candidate", () => {
    expect(leastOverlappingIndex([[[0, 0], [0, 1]]], [[0, 0]], 25)).toBe(0);
  });
});
