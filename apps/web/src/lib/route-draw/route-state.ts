import type {
  Position,
  RouteDoc,
  RouteSegment,
  RouteState,
  Waypoint,
} from "./types";

/**
 * Pure reducer + selectors for the editable route model (Phase 1).
 *
 * Committed mutations (add/remove/truncate/clear) snapshot the previous doc
 * onto the undo stack and clear redo; ephemeral updates (preview, truncation,
 * status) never touch history. Nothing here talks to the network — callers
 * supply already-routed segments (from /segment) and snapped waypoints.
 */

export const emptyDoc = (): RouteDoc => ({ waypoints: [], segments: [] });

export const initialRouteState = (): RouteState => ({
  present: emptyDoc(),
  past: [],
  future: [],
  preview: null,
  truncation: null,
  status: "idle",
});

export type RouteAction =
  | { type: "addStart"; waypoint: Waypoint }
  | { type: "addWaypoint"; waypoint: Waypoint; segment: RouteSegment }
  | { type: "setDoc"; doc: RouteDoc }
  | { type: "removeLast" }
  | { type: "truncate"; keepThroughWaypointId: string }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setPreview"; segment: RouteSegment | null }
  | { type: "setTruncation"; truncation: RouteState["truncation"] }
  | { type: "setStatus"; status: RouteState["status"] };

/** Replace `present` with `next`, snapshotting the old doc for undo. */
function commit(state: RouteState, next: RouteDoc): RouteState {
  return {
    ...state,
    past: [...state.past, state.present],
    present: next,
    future: [],
    preview: null,
    truncation: null,
  };
}

export function routeReducer(state: RouteState, action: RouteAction): RouteState {
  switch (action.type) {
    case "addStart": {
      // Only meaningful as the very first point.
      if (state.present.waypoints.length > 0) return state;
      return commit(state, { waypoints: [action.waypoint], segments: [] });
    }
    case "addWaypoint": {
      if (state.present.waypoints.length === 0) return state; // need a start first
      return commit(state, {
        waypoints: [...state.present.waypoints, action.waypoint],
        segments: [...state.present.segments, action.segment],
      });
    }
    case "setDoc": {
      // Replace the whole route in one undoable step (e.g. after a drag builds
      // a fresh set of routed segments).
      return commit(state, action.doc);
    }
    case "removeLast": {
      const { waypoints, segments } = state.present;
      if (waypoints.length === 0) return state;
      return commit(state, {
        waypoints: waypoints.slice(0, -1),
        // Removing the start (1 waypoint, 0 segments) leaves an empty doc.
        segments: segments.slice(0, Math.max(0, waypoints.length - 2)),
      });
    }
    case "truncate": {
      const idx = state.present.waypoints.findIndex(
        (w) => w.id === action.keepThroughWaypointId,
      );
      if (idx < 0) return state;
      // Keep waypoints[0..idx] and the segments between them (idx of them).
      const waypoints = state.present.waypoints.slice(0, idx + 1);
      const segments = state.present.segments.slice(0, idx);
      // No-op if nothing would change (already the endpoint).
      if (
        waypoints.length === state.present.waypoints.length &&
        segments.length === state.present.segments.length
      ) {
        return state;
      }
      return commit(state, { waypoints, segments });
    }
    case "clear": {
      if (
        state.present.waypoints.length === 0 &&
        state.present.segments.length === 0
      ) {
        return { ...state, preview: null, truncation: null };
      }
      return commit(state, emptyDoc());
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        preview: null,
        truncation: null,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: rest,
        preview: null,
        truncation: null,
      };
    }
    case "setPreview":
      return { ...state, preview: action.segment };
    case "setTruncation":
      return { ...state, truncation: action.truncation };
    case "setStatus":
      return { ...state, status: action.status };
    default: {
      // Exhaustiveness guard — a new action type must be handled above.
      const _never: never = action;
      return _never;
    }
  }
}

// --- Selectors ---

export const canUndo = (state: RouteState): boolean => state.past.length > 0;
export const canRedo = (state: RouteState): boolean => state.future.length > 0;

/** The current drawing endpoint (last waypoint), or null for an empty route. */
export function endpoint(doc: RouteDoc): Waypoint | null {
  return doc.waypoints.length > 0 ? doc.waypoints[doc.waypoints.length - 1] : null;
}

/** Total committed distance in metres (sum of segment distances). */
export function totalDistanceMeters(doc: RouteDoc): number {
  return doc.segments.reduce((sum, s) => sum + s.distanceMeters, 0);
}

/**
 * Flatten the committed segments into one coordinate list, dropping the shared
 * point at each join so there are no duplicates. Returns [] for a route with no
 * segments (a lone start point isn't a routable line).
 */
export function assembleCoordinates(doc: RouteDoc): Position[] {
  const out: Position[] = [];
  doc.segments.forEach((segment, i) => {
    const coords = segment.geometry.coordinates as Position[];
    const from = i === 0 ? 0 : 1;
    for (let j = from; j < coords.length; j++) out.push(coords[j]);
  });
  return out;
}
