import { describe, expect, it } from "vitest";
import { findRewindTarget, type BacktrackOptions } from "./backtrack";
import type { Position } from "./types";

// ~0.0001° ≈ 11 m of longitude at the equator; use a helper to build paths in
// metres-ish steps eastward from an origin.
const M = 1 / 111_320; // degrees per metre (lat); good enough near the equator
const origin: Position = [0, 0];

/** A path heading east, one point every `stepM` metres, `count` points. */
function eastward(stepM: number, count: number): Position[] {
  const pts: Position[] = [];
  for (let i = 0; i < count; i++) pts.push([i * stepM * M, 0]);
  return pts;
}

const opts: BacktrackOptions = {
  proximityMeters: 22,
  recentWindowMeters: 140,
  minRewindMeters: 14,
};

describe("findRewindTarget", () => {
  it("returns null for a short path", () => {
    expect(findRewindTarget([origin, [M * 10, 0]], [M * 5, 0], opts)).toBeNull();
  });

  it("returns null when the cursor keeps moving forward", () => {
    const path = eastward(20, 10); // 0..180 m east
    const ahead: Position = [200 * M, 0]; // past the tip
    expect(findRewindTarget(path, ahead, opts)).toBeNull();
  });

  it("rewinds when the cursor doubles back over the recent tail", () => {
    const path = eastward(20, 10); // points at 0,20,...,180 m (indices 0..9)
    // Cursor comes back near the point at 100 m (index 5).
    const target = findRewindTarget(path, [100 * M, 0], opts);
    expect(target).toBe(5);
  });

  it("ignores tiny jitter right at the tip (minRewind guard)", () => {
    const path = eastward(20, 10); // tip at 180 m
    // Cursor sits ~5 m behind the tip — within minRewind, not a real backtrack.
    expect(findRewindTarget(path, [175 * M, 0], opts)).toBeNull();
  });

  it("does NOT rewind when returning near an OLDER part (loop preserved)", () => {
    // A long path; the cursor returns near the very start, which is far older
    // than the recent window — that's a loop closing, not a backtrack.
    const path = eastward(20, 20); // 0..380 m; start is 380 m back from the tip
    expect(findRewindTarget(path, origin, opts)).toBeNull();
  });

  it("picks the closest recent point when several are near", () => {
    // Path east then the cursor near the 120 m point (index 6) more than the
    // 100 m point — expect the closer one.
    const path = eastward(20, 10);
    const target = findRewindTarget(path, [118 * M, 0], opts);
    expect(target).toBe(6);
  });
});
