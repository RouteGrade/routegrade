import { haversineMeters } from "@/lib/geo";
import type { Position } from "./types";

/**
 * Backtracking detection for the drawing tool.
 *
 * While drawing, if the cursor doubles back over the route it JUST drew, that's
 * a correction — the path should rewind (shorten), not draw an overlapping
 * segment on top of itself. But returning near an *older* part of the route
 * (closing a loop, a figure-eight, or reusing a road later) is intentional and
 * must be preserved. We distinguish the two by only ever matching against the
 * recent tail of the path: anything older than `recentWindowMeters` is off
 * limits, so a loop that closes far from where it started keeps growing.
 */

export type BacktrackOptions = {
  /** Cursor must be within this many metres of the recent path to rewind. */
  proximityMeters: number;
  /** Only the last N metres of the path are considered (older = a loop). */
  recentWindowMeters: number;
  /** Ignore rewinds shorter than this, so jitter near the tip never truncates. */
  minRewindMeters: number;
};

export const DEFAULT_BACKTRACK: BacktrackOptions = {
  proximityMeters: 22,
  recentWindowMeters: 140,
  minRewindMeters: 14,
};

/**
 * If the cursor is doubling back over the recently-drawn tail, return the index
 * to rewind the path to (keep points[0..index], drop the rest). Otherwise null.
 */
export function findRewindTarget(
  points: Position[],
  cursor: Position,
  opts: BacktrackOptions = DEFAULT_BACKTRACK,
): number | null {
  const n = points.length;
  if (n < 3) return null;

  // Walk backward from the tip, accumulating arc length. A candidate is a point
  // that sits between minRewind and recentWindow metres back, within proximity
  // of the cursor, AND closer to the cursor than the tip is (so the cursor is
  // genuinely behind, not just short of the tip). Pick the closest such point.
  const distToTip = haversineMeters(cursor, points[n - 1]);
  let arc = 0;
  let best: { index: number; dist: number } | null = null;
  for (let i = n - 1; i > 0; i--) {
    arc += haversineMeters(points[i], points[i - 1]);
    if (arc < opts.minRewindMeters) continue; // too near the tip — just jitter
    if (arc > opts.recentWindowMeters) break; // older than the recent window
    const dist = haversineMeters(cursor, points[i - 1]);
    if (
      dist <= opts.proximityMeters &&
      dist < distToTip &&
      (best === null || dist < best.dist)
    ) {
      best = { index: i - 1, dist };
    }
  }
  return best ? best.index : null;
}
