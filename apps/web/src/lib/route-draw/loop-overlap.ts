import { haversineMeters } from "@/lib/geo";
import type { Position } from "./types";

/**
 * Loop mode picks the return leg that retraces the outbound route the least.
 * OSRM can't strictly avoid edges, so we score each candidate by how much of
 * its geometry runs close to streets already used, and take the lowest.
 */

/** Fraction of `candidate` points that sit within `toleranceMeters` of `used`. */
export function overlapFraction(
  candidate: Position[],
  used: Position[],
  toleranceMeters = 25,
): number {
  if (candidate.length === 0 || used.length === 0) return 0;
  let overlapping = 0;
  for (const point of candidate) {
    for (const u of used) {
      if (haversineMeters(point, u) <= toleranceMeters) {
        overlapping++;
        break;
      }
    }
  }
  return overlapping / candidate.length;
}

/**
 * Index of the candidate that overlaps `used` the least. Returns 0 for a single
 * candidate (or none better). Ties keep the earlier (usually shorter) option.
 */
export function leastOverlappingIndex(
  candidates: Position[][],
  used: Position[],
  toleranceMeters = 25,
): number {
  let bestIndex = 0;
  let bestOverlap = Infinity;
  candidates.forEach((candidate, i) => {
    const overlap = overlapFraction(candidate, used, toleranceMeters);
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      bestIndex = i;
    }
  });
  return bestIndex;
}
