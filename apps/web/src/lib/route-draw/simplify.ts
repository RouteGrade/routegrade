import { haversineMeters } from "@/lib/geo";
import type { Position } from "./types";

/**
 * Ramer–Douglas–Peucker simplification of a drawn path.
 *
 * A finger/mouse drag produces hundreds of jittery points; routing every
 * consecutive pair would be hundreds of API calls. Instead we keep only the
 * path's *key vertices* (its corners) — the points that express where the
 * runner intended to turn — and route between those. Typical output for a real
 * drag is a handful to a couple dozen vertices.
 *
 * `toleranceMeters` is the max perpendicular distance a point may sit from the
 * kept polyline before it's kept too.
 */
export function simplifyPath(points: Position[], toleranceMeters: number): Position[] {
  if (points.length <= 2) return points.slice();

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularMeters(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceMeters) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/**
 * Perpendicular distance (metres) from `p` to the segment a→b, using a local
 * equirectangular projection (metres) around `a` — accurate enough at the
 * street scale this runs at.
 */
function perpendicularMeters(p: Position, a: Position, b: Position): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((a[1] * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b[0] - a[0]) * mPerDegLng;
  const by = (b[1] - a[1]) * mPerDegLat;
  const px = (p[0] - a[0]) * mPerDegLng;
  const py = (p[1] - a[1]) * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversineMeters(p, a);

  // Project p onto the segment, clamped to [0,1].
  let t = (px * dx + py * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
