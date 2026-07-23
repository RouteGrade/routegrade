/**
 * Geospatial helpers for live run tracking.
 *
 * Everything works on [longitude, latitude] pairs (GeoJSON order) and uses
 * real-world meters (haversine / local equirectangular), unlike the planar
 * degrees the map's draw animation uses — pace math needs true distances.
 */

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Reference latitude for a route's local equirectangular frame — anchored to
 * the route itself (not whatever point happens to be queried against it) so
 * `projectOntoPath` and `sliceRouteAtDistance` measure "distance along the
 * route" the same way and agree on where a given meter mark actually falls.
 */
function routeCosLat(coords: LngLat[]): number {
  const lat = coords[Math.floor(coords.length / 2)]?.[1] ?? 0;
  return Math.cos(toRad(lat));
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a path in meters. */
export function pathLengthMeters(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Project `point` onto the polyline, in a local equirectangular frame (fine
 * for the sub-km scales of a run). Returns the distance from the point to the
 * route in meters, how far along the route the closest spot is, and the
 * closest spot itself (e.g. for framing a map camera around the gap).
 */
export function projectOntoPath(
  point: LngLat,
  coords: LngLat[],
): { distanceToPathM: number; alongPathM: number; nearestPoint: LngLat } {
  const cosLat = routeCosLat(coords);
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * cosLat;

  const px = point[0] * mPerDegLng;
  const py = point[1] * mPerDegLat;

  let best = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let bestPoint: LngLat = coords[0] ?? point;
  let cumulative = 0;

  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][0] * mPerDegLng;
    const ay = coords[i - 1][1] * mPerDegLat;
    const bx = coords[i][0] * mPerDegLng;
    const by = coords[i][1] * mPerDegLat;
    const segX = bx - ax;
    const segY = by - ay;
    const segLen2 = segX * segX + segY * segY;
    const t = segLen2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * segX + (py - ay) * segY) / segLen2)) : 0;
    const cx = ax + segX * t;
    const cy = ay + segY * t;
    const dist = Math.hypot(px - cx, py - cy);
    const segLen = Math.sqrt(segLen2);
    if (dist < best) {
      best = dist;
      bestAlong = cumulative + segLen * t;
      bestPoint = [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
    cumulative += segLen;
  }

  return { distanceToPathM: best, alongPathM: bestAlong, nearestPoint: bestPoint };
}

/** Distance from the route past which a runner is considered off it. */
export const OFF_ROUTE_M = 50;

/**
 * Portion of `coords` from the start up to `targetM` meters along the path,
 * with an interpolated point at the cut. Feed it `projectOntoPath`'s
 * `alongPathM` to slice a route at a runner's current progress — both use
 * the same route-anchored equirectangular frame (see `routeCosLat`), so the
 * cut lands exactly at the runner's projected foot rather than drifting.
 */
export function sliceRouteAtDistance(coords: LngLat[], targetM: number): LngLat[] {
  if (coords.length === 0) return [];
  const cosLat = routeCosLat(coords);
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * cosLat;

  const out: LngLat[] = [coords[0]];
  let cumulative = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * mPerDegLng;
    const dy = (coords[i][1] - coords[i - 1][1]) * mPerDegLat;
    const segment = Math.hypot(dx, dy);
    if (cumulative + segment <= targetM) {
      out.push(coords[i]);
      cumulative += segment;
      continue;
    }
    const t = segment > 0 ? Math.max(0, Math.min(1, (targetM - cumulative) / segment)) : 0;
    out.push([
      coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
      coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
    ]);
    return out;
  }
  return out;
}

/**
 * Portion of `coords` from `targetM` meters along the path to the end, with
 * an interpolated point at the cut — the complement of `sliceRouteAtDistance`.
 * On an out-and-back or a loop that retraces a road, feeding this the
 * runner's `alongPathM` keeps direction-arrow rendering limited to the road
 * ahead: the already-run direction (behind the cut) drops out entirely, so
 * only one direction is ever shown for a given stretch until the runner
 * actually reaches wherever the route doubles back over itself.
 */
export function remainingRouteFromDistance(coords: LngLat[], targetM: number): LngLat[] {
  if (coords.length === 0) return [];
  const cosLat = routeCosLat(coords);
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLng = mPerDegLat * cosLat;

  let cumulative = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * mPerDegLng;
    const dy = (coords[i][1] - coords[i - 1][1]) * mPerDegLat;
    const segment = Math.hypot(dx, dy);
    if (cumulative + segment <= targetM) {
      cumulative += segment;
      continue;
    }
    const t = segment > 0 ? Math.max(0, Math.min(1, (targetM - cumulative) / segment)) : 0;
    const cut: LngLat = [
      coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
      coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
    ];
    return [cut, ...coords.slice(i)];
  }
  return [coords[coords.length - 1]];
}

/** "5:42" from seconds-per-km; em dash when pace is meaningless. */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
    return "—:—";
  }
  const clamped = Math.min(secondsPerKm, 59 * 60 + 59);
  const min = Math.floor(clamped / 60);
  const sec = Math.round(clamped % 60);
  return sec === 60 ? `${min + 1}:00` : `${min}:${String(sec).padStart(2, "0")}`;
}

/** "42:07" or "1:02:07" from total seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Spoken form of a pace for audio cues: "5 minutes 42 seconds per kilometer". */
export function spokenPace(secondsPerKm: number): string {
  const min = Math.floor(secondsPerKm / 60);
  const sec = Math.round(secondsPerKm % 60);
  if (min === 0) return `${sec} seconds per kilometer`;
  if (sec === 0) return `${min} minutes per kilometer`;
  return `${min} minutes ${sec} seconds per kilometer`;
}
