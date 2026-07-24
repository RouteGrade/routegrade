"use client";

import { useCallback, useMemo, useReducer, useRef } from "react";
import { routeSegment, type RoutedSegment } from "@/lib/api/routes-client";
import {
  assembleCoordinates,
  canRedo,
  canUndo,
  initialRouteState,
  routeReducer,
  totalDistanceMeters,
} from "./route-state";
import { simplifyPath } from "./simplify";
import type { Position, RouteDoc, RouteSegment, Waypoint } from "./types";

/** Max perpendicular distance (m) a drawn point may sit from the kept polyline. */
const RDP_TOLERANCE_M = 18;

const uid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/**
 * Assemble a committed RouteDoc from the drag's key vertices and the routed
 * segment for each consecutive pair. Segment i joins verts[i] → verts[i+1];
 * the snapped waypoint positions come from the routed geometry's endpoints.
 */
export function buildDoc(verts: Position[], segments: RoutedSegment[]): RouteDoc {
  const first = segments[0].geometry.coordinates as Position[];
  const waypoints: Waypoint[] = [{ id: uid(), raw: verts[0], snapped: first[0] }];
  const outSegments: RouteSegment[] = [];

  segments.forEach((seg, i) => {
    const coords = seg.geometry.coordinates as Position[];
    const end: Waypoint = {
      id: uid(),
      raw: verts[i + 1],
      snapped: coords[coords.length - 1],
    };
    outSegments.push({
      id: uid(),
      startWaypointId: waypoints[i].id,
      endWaypointId: end.id,
      geometry: seg.geometry,
      distanceMeters: seg.distanceMeters,
    });
    waypoints.push(end);
  });

  return { waypoints, segments: outSegments };
}

export function useRouteDraw() {
  const [state, dispatch] = useReducer(routeReducer, undefined, initialRouteState);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  /**
   * Turn a raw drag path into a structured, road-snapped route: simplify to key
   * vertices, then route each consecutive pair in parallel (each is
   * independent) and commit the assembled route in one undoable step. Guarded
   * against overlapping builds (abort + sequence check).
   */
  const buildFromDrag = useCallback(async (raw: Position[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;

    const verts = simplifyPath(raw, RDP_TOLERANCE_M);
    if (verts.length < 2) return;

    dispatch({ type: "setStatus", status: "routing" });
    try {
      const segments = await Promise.all(
        verts.slice(1).map((v, i) => routeSegment(verts[i], v, controller.signal)),
      );
      if (seq !== seqRef.current) return; // a newer build superseded this one
      dispatch({ type: "setDoc", doc: buildDoc(verts, segments) });
      dispatch({ type: "setStatus", status: "idle" });
    } catch {
      if (controller.signal.aborted) return;
      dispatch({ type: "setStatus", status: "invalid" });
    }
  }, []);

  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);
  const removeLast = useCallback(() => dispatch({ type: "removeLast" }), []);

  const coordinates = useMemo(
    () => assembleCoordinates(state.present),
    [state.present],
  );

  return {
    state,
    coordinates,
    distanceMeters: totalDistanceMeters(state.present),
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    hasRoute: state.present.segments.length > 0,
    isRouting: state.status === "routing",
    error: state.status === "invalid",
    buildFromDrag,
    undo,
    redo,
    clear,
    removeLast,
  };
}
