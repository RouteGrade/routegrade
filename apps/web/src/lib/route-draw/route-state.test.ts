import { describe, expect, it } from "vitest";
import {
  assembleCoordinates,
  canRedo,
  canUndo,
  endpoint,
  initialRouteState,
  replaceWaypointSegments,
  routeReducer,
  totalDistanceMeters,
  type RouteAction,
} from "./route-state";
import type { Position, RouteSegment, RouteState, Waypoint } from "./types";

const wp = (id: string, p: Position): Waypoint => ({ id, raw: p, snapped: p });

const seg = (
  id: string,
  a: string,
  b: string,
  coords: Position[],
  dist: number,
): RouteSegment => ({
  id,
  startWaypointId: a,
  endWaypointId: b,
  geometry: { type: "LineString", coordinates: coords },
  distanceMeters: dist,
});

const reduce = (state: RouteState, ...actions: RouteAction[]): RouteState =>
  actions.reduce(routeReducer, state);

/** A → B → C → D route (3 segments, 300 m total). */
function buildAbcd(): RouteState {
  return reduce(
    initialRouteState(),
    { type: "addStart", waypoint: wp("A", [0, 0]) },
    { type: "addWaypoint", waypoint: wp("B", [1, 0]), segment: seg("s1", "A", "B", [[0, 0], [1, 0]], 100) },
    { type: "addWaypoint", waypoint: wp("C", [2, 0]), segment: seg("s2", "B", "C", [[1, 0], [2, 0]], 100) },
    { type: "addWaypoint", waypoint: wp("D", [3, 0]), segment: seg("s3", "C", "D", [[2, 0], [3, 0]], 100) },
  );
}

describe("routeReducer — building a route", () => {
  it("starts empty", () => {
    const s = initialRouteState();
    expect(s.present.waypoints).toHaveLength(0);
    expect(s.present.segments).toHaveLength(0);
    expect(endpoint(s.present)).toBeNull();
  });

  it("keeps the invariant: N waypoints ⇒ N-1 segments", () => {
    const s = buildAbcd();
    expect(s.present.waypoints).toHaveLength(4);
    expect(s.present.segments).toHaveLength(3);
    expect(endpoint(s.present)?.id).toBe("D");
  });

  it("ignores addWaypoint before a start, and a second addStart", () => {
    const s1 = routeReducer(initialRouteState(), {
      type: "addWaypoint",
      waypoint: wp("B", [1, 0]),
      segment: seg("s", "A", "B", [[0, 0], [1, 0]], 100),
    });
    expect(s1.present.waypoints).toHaveLength(0);

    const s2 = reduce(
      initialRouteState(),
      { type: "addStart", waypoint: wp("A", [0, 0]) },
      { type: "addStart", waypoint: wp("A2", [9, 9]) },
    );
    expect(s2.present.waypoints).toHaveLength(1);
    expect(s2.present.waypoints[0].id).toBe("A");
  });
});

describe("routeReducer — removeLast", () => {
  it("removes the last waypoint and its segment", () => {
    const s = routeReducer(buildAbcd(), { type: "removeLast" });
    expect(s.present.waypoints.map((w) => w.id)).toEqual(["A", "B", "C"]);
    expect(s.present.segments.map((x) => x.id)).toEqual(["s1", "s2"]);
  });

  it("removing back to the start leaves an empty doc", () => {
    let s = reduce(
      initialRouteState(),
      { type: "addStart", waypoint: wp("A", [0, 0]) },
      { type: "addWaypoint", waypoint: wp("B", [1, 0]), segment: seg("s1", "A", "B", [[0, 0], [1, 0]], 100) },
    );
    s = routeReducer(s, { type: "removeLast" }); // -> just A
    expect(s.present.waypoints.map((w) => w.id)).toEqual(["A"]);
    expect(s.present.segments).toHaveLength(0);
    s = routeReducer(s, { type: "removeLast" }); // -> empty
    expect(s.present.waypoints).toHaveLength(0);
    expect(s.present.segments).toHaveLength(0);
  });
});

describe("routeReducer — truncate", () => {
  it("drops all waypoints/segments after the kept one", () => {
    const s = routeReducer(buildAbcd(), { type: "truncate", keepThroughWaypointId: "B" });
    expect(s.present.waypoints.map((w) => w.id)).toEqual(["A", "B"]);
    expect(s.present.segments.map((x) => x.id)).toEqual(["s1"]);
  });

  it("is a no-op when keeping through the current endpoint or an unknown id", () => {
    const base = buildAbcd();
    expect(routeReducer(base, { type: "truncate", keepThroughWaypointId: "D" })).toBe(base);
    expect(routeReducer(base, { type: "truncate", keepThroughWaypointId: "Z" })).toBe(base);
  });
});

describe("routeReducer — undo/redo", () => {
  it("undoes and redoes committed changes", () => {
    const abcd = buildAbcd();
    const truncated = routeReducer(abcd, { type: "truncate", keepThroughWaypointId: "B" });
    expect(truncated.present.waypoints).toHaveLength(2);

    const undone = routeReducer(truncated, { type: "undo" });
    expect(undone.present.waypoints.map((w) => w.id)).toEqual(["A", "B", "C", "D"]);
    expect(canRedo(undone)).toBe(true);

    const redone = routeReducer(undone, { type: "redo" });
    expect(redone.present.waypoints.map((w) => w.id)).toEqual(["A", "B"]);
  });

  it("clears redo after a new commit, and no-ops at the ends", () => {
    const abcd = buildAbcd();
    const undone = routeReducer(abcd, { type: "undo" }); // back to A,B,C
    expect(canRedo(undone)).toBe(true);
    const branched = routeReducer(undone, { type: "removeLast" }); // new commit
    expect(canRedo(branched)).toBe(false);

    const empty = initialRouteState();
    expect(routeReducer(empty, { type: "undo" })).toBe(empty);
    expect(routeReducer(empty, { type: "redo" })).toBe(empty);
  });

  it("undo count matches the number of committed steps", () => {
    let s = buildAbcd(); // 4 commits (addStart + 3 addWaypoint)
    expect(canUndo(s)).toBe(true);
    for (let i = 0; i < 4; i++) s = routeReducer(s, { type: "undo" });
    expect(canUndo(s)).toBe(false);
    expect(s.present.waypoints).toHaveLength(0);
  });
});

describe("routeReducer — ephemeral state does not touch history", () => {
  it("preview / truncation / status leave past+future untouched", () => {
    const s = buildAbcd();
    const pastLen = s.past.length;
    const withPreview = reduce(
      s,
      { type: "setPreview", segment: seg("p", "D", "X", [[3, 0], [4, 0]], 50) },
      { type: "setTruncation", truncation: { keepThroughWaypointId: "B", atPoint: [1, 0] } },
      { type: "setStatus", status: "routing" },
    );
    expect(withPreview.past).toHaveLength(pastLen);
    expect(withPreview.future).toHaveLength(0);
    expect(withPreview.preview?.id).toBe("p");
    expect(withPreview.status).toBe("routing");
    // A committing action clears the preview + truncation.
    const committed = routeReducer(withPreview, { type: "removeLast" });
    expect(committed.preview).toBeNull();
    expect(committed.truncation).toBeNull();
  });
});

describe("replaceWaypointSegments (drag a waypoint)", () => {
  it("moving a MIDDLE waypoint replaces both adjacent segments", () => {
    const doc = buildAbcd().present; // A,B,C,D with s1,s2,s3
    const movedB: ReturnType<typeof wp> = wp("B", [1, 0.5]);
    const inc = seg("n1", "A", "B", [[0, 0], [1, 0.5]], 90); // A→B'
    const out = seg("n2", "B", "C", [[1, 0.5], [2, 0]], 90); // B'→C
    const next = replaceWaypointSegments(doc, 1, movedB, inc, out);

    expect(next.waypoints[1]).toBe(movedB);
    expect(next.segments.map((s) => s.id)).toEqual(["n1", "n2", "s3"]);
    // Original doc is untouched (pure).
    expect(doc.segments.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(totalDistanceMeters(next)).toBe(90 + 90 + 100);
  });

  it("moving the FIRST waypoint replaces only the outgoing segment", () => {
    const doc = buildAbcd().present;
    const movedA = wp("A", [-0.5, 0]);
    const out = seg("n1", "A", "B", [[-0.5, 0], [1, 0]], 150);
    const next = replaceWaypointSegments(doc, 0, movedA, null, out);
    expect(next.segments.map((s) => s.id)).toEqual(["n1", "s2", "s3"]);
    expect(next.waypoints[0]).toBe(movedA);
  });

  it("moving the LAST waypoint replaces only the incoming segment", () => {
    const doc = buildAbcd().present;
    const movedD = wp("D", [3, 0.5]);
    const inc = seg("n3", "C", "D", [[2, 0], [3, 0.5]], 140);
    const next = replaceWaypointSegments(doc, 3, movedD, inc, null);
    expect(next.segments.map((s) => s.id)).toEqual(["s1", "s2", "n3"]);
    expect(next.waypoints[3]).toBe(movedD);
  });
});

describe("selectors", () => {
  it("sums committed distance", () => {
    expect(totalDistanceMeters(buildAbcd().present)).toBe(300);
    expect(totalDistanceMeters(initialRouteState().present)).toBe(0);
  });

  it("assembles coordinates, dropping the shared join points", () => {
    const coords = assembleCoordinates(buildAbcd().present);
    expect(coords).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });

  it("assembles [] for a lone start (no routable segment yet)", () => {
    const s = routeReducer(initialRouteState(), { type: "addStart", waypoint: wp("A", [0, 0]) });
    expect(assembleCoordinates(s.present)).toEqual([]);
  });
});
