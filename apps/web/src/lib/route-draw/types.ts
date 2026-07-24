import type { LineString } from "geojson";

/**
 * Editable route model for the road-snapped drawing tool (Phase 1).
 *
 * A route is NOT a flat list of cursor coordinates — it's a list of waypoints
 * joined by routed segments. That structure is what makes undo/redo,
 * truncation, per-segment re-routing, and distance recompute tractable.
 *
 *   Route
 *   ├── Waypoint A
 *   ├── Segment A → B   (routed geometry + distance)
 *   ├── Waypoint B
 *   └── Segment B → C
 *
 * Invariant: `segments[i]` connects `waypoints[i]` to `waypoints[i+1]`, so a
 * doc with N waypoints (N ≥ 1) has exactly N-1 segments.
 */

export type Position = [number, number];

export type Waypoint = {
  id: string;
  /** Raw cursor position the user placed. */
  raw: Position;
  /** Position snapped onto the routable network (via /nearest or a segment). */
  snapped: Position;
};

export type RouteSegment = {
  id: string;
  startWaypointId: string;
  endWaypointId: string;
  geometry: LineString;
  distanceMeters: number;
};

/** The committed route — the unit that undo/redo snapshots. */
export type RouteDoc = {
  waypoints: Waypoint[];
  segments: RouteSegment[];
};

/** An uncommitted truncation the user is about to confirm (backtracking). */
export type TruncationPreview = {
  /** The route is kept through this waypoint; everything after is removed. */
  keepThroughWaypointId: string;
  /** Point on the route the truncation lands on (for the preview marker). */
  atPoint: Position;
};

export type RouteStatus = "idle" | "routing" | "invalid";

export type RouteState = {
  present: RouteDoc;
  /** Undo stack (older committed docs). */
  past: RouteDoc[];
  /** Redo stack (docs undone). */
  future: RouteDoc[];
  /** Uncommitted routed segment from the current endpoint to the cursor. */
  preview: RouteSegment | null;
  /** Uncommitted truncation preview while backtracking. */
  truncation: TruncationPreview | null;
  status: RouteStatus;
};
