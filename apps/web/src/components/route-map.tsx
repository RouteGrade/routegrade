"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LineString } from "geojson";
import {
  OFF_ROUTE_M,
  projectOntoPath,
  remainingRouteFromDistance,
  sliceRouteAtDistance,
} from "@/lib/geo";

const DOWNTOWN_TORONTO: [number, number] = [-79.3832, 43.6532];
const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://demotiles.maplibre.org/style.json";

const ROUTE_SOURCE = "active-route";
const ROUTE_DASHED_LAYER = "route-dashed";
const ROUTE_ARROW_ICON = "route-arrow";
const ROUTE_ARROWS_LAYER = "route-direction-arrows";
// A dedicated source, not ROUTE_SOURCE — arrows need to show only the road
// *ahead* of the runner once one exists (see the runner-telemetry effect),
// which is a different slice of the route than the persistent dashed/
// gradient line, itself always shows.
const ROUTE_ARROWS_SOURCE = "route-direction-source";
// The geometry effect below only ever *hides* ROUTE_DASHED_LAYER (when the
// route disappears) — showing it is owned solely by the follow effect, so
// the two never fight over the same layer's visibility. Direction arrows,
// unlike the dashed/gradient line swap, are relevant in every mode (they're
// what tells a runner which way around a loop or overlapping out-and-back
// to go), so they're owned here alongside the base line layers instead.
const ROUTE_LAYERS = ["route-glow", "route-line", ROUTE_ARROWS_LAYER] as const;
const TRAVELED_SOURCE = "run-traveled";
const TRAVELED_LAYER = "run-traveled-line";
// The in-progress freehand line the user draws in "create your own route" mode.
const DRAW_SOURCE = "draw-route";
const DRAW_LAYER = "draw-route-line";
// Camera-follow zoom while running; gentle enough to keep context visible.
const FOLLOW_ZOOM = 15.5;

// Camera settles first, then the route draws itself from start to finish.
const FIT_DURATION_MS = 1400;
// Breather between the camera settling and the line starting to draw.
const DRAW_DELAY_MS = 350;
// Draw pacing scales with route length so long loops don't zip by,
// clamped so short strolls still feel deliberate and long runs don't drag.
const DRAW_MIN_MS = 3200;
const DRAW_MAX_MS = 6000;
const DRAW_MS_PER_KM = 450;
// Rough km per planar degree around mid latitudes — only used to pace the draw.
const KM_PER_DEGREE = 95;

type Coord = [number, number];

function lineStringData(coordinates: Coord[]): GeoJSON.Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

/** Cumulative planar distances — good enough to pace a draw animation. */
function cumulativeDistances(coords: Coord[]): number[] {
  const distances = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    distances.push(distances[i - 1] + Math.hypot(dx, dy));
  }
  return distances;
}

/** Slice of the line from its start up to `target` along `distances`, with an interpolated tip. */
function partialLine(coords: Coord[], distances: number[], target: number): Coord[] {
  const total = distances[distances.length - 1];
  if (target >= total) return coords;
  const out: Coord[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (distances[i] <= target) {
      out.push(coords[i]);
      continue;
    }
    const segment = distances[i] - distances[i - 1];
    const t = segment > 0 ? (target - distances[i - 1]) / segment : 0;
    out.push([
      coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
      coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
    ]);
    break;
  }
  return out;
}

/** Gentler than cubic — the line eases in softly and coasts to a stop. */
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * An east-pointing (+x) chevron for the direction-arrow layer. With
 * `symbol-placement: "line"` + `icon-rotation-alignment: "map"`, MapLibre
 * aligns the icon's *x-axis* with the line's tangent (per the style spec —
 * not its y-axis), so the tip has to point right, not up, for the rendered
 * arrow to actually follow the route instead of sitting perpendicular to it.
 */
function createArrowIcon(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(size, size);

  const cx = size / 2;
  const cy = size / 2;
  const half = size * 0.34;
  ctx.beginPath();
  ctx.moveTo(cx + half, cy);
  ctx.lineTo(cx - half * 0.7, cy - half * 0.65);
  ctx.lineTo(cx - half * 0.7, cy + half * 0.65);
  ctx.closePath();
  ctx.fillStyle = "#fafafa";
  ctx.fill();
  ctx.strokeStyle = "rgba(9, 9, 11, 0.7)";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

export type RunnerState = {
  /** Live GPS position, [lng, lat]. */
  position: Coord;
};

export type RouteMapProps = {
  /** GeoJSON LineString of the route to draw, or null to hide the route. */
  geometry: LineString | null;
  /** Live run telemetry, or null when no run is in progress. */
  runner?: RunnerState | null;
  /** Ease the camera after the runner while true (until the user pans away). */
  follow?: boolean;
  /** When true, the map enters freehand draw mode (pan disabled). */
  drawing?: boolean;
  /** Fires with the drawn [lng, lat] path when a freehand stroke finishes. */
  onDrawComplete?: (coordinates: Coord[]) => void;
};

export default function RouteMap({
  geometry,
  runner = null,
  follow = false,
  drawing = false,
  onDrawComplete,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const tipMarkerRef = useRef<maplibregl.Marker | null>(null);
  const runnerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const followRef = useRef(follow);
  // A user pan/zoom suspends camera follow until Re-center is tapped.
  const [followSuspended, setFollowSuspended] = useState(false);
  const [prevFollow, setPrevFollow] = useState(follow);
  const styleReadyRef = useRef(false);
  // Latest onDrawComplete, read from the draw handlers without re-binding them.
  const onDrawCompleteRef = useRef(onDrawComplete);
  useEffect(() => {
    onDrawCompleteRef.current = onDrawComplete;
  }, [onDrawComplete]);

  // Render-phase adjustment: a fresh run always starts with follow engaged.
  if (follow !== prevFollow) {
    setPrevFollow(follow);
    if (!follow) setFollowSuspended(false);
  }
  const animationFrameRef = useRef<number | null>(null);
  const drawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DOWNTOWN_TORONTO,
      zoom: 13.4,
      pitch: 45,
      bearing: -17,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.AttributionControl({
        compact: false,
        customAttribution: "© OpenStreetMap contributors",
      }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: lineStringData([]),
        lineMetrics: true,
      });
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: ROUTE_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
          visibility: "none",
        },
        paint: {
          "line-color": "#34d399",
          "line-width": 14,
          "line-opacity": 0.35,
          "line-blur": 6,
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
          visibility: "none",
        },
        paint: {
          "line-width": 4.5,
          "line-opacity": 0.95,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "#22d3ee",
            0.5,
            "#34d399",
            1,
            "#a3e635",
          ],
        },
      });
      // Flat color, not the gradient `route-line` uses — MapLibre disables
      // line-gradient on any layer with a line-dasharray set, so the
      // persistent-dashed run style needs its own layer rather than
      // dashing route-line directly.
      map.addLayer({
        id: ROUTE_DASHED_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
          visibility: "none",
        },
        paint: {
          "line-color": "#34d399",
          "line-width": 4.5,
          "line-opacity": 0.55,
          "line-dasharray": [1.6, 1.6],
        },
      });
      map.addSource(TRAVELED_SOURCE, {
        type: "geojson",
        data: lineStringData([]),
      });
      map.addLayer({
        id: TRAVELED_LAYER,
        type: "line",
        source: TRAVELED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#fafafa",
          "line-width": 5,
          "line-opacity": 0.9,
        },
      });
      // Freehand draw-mode line — bright and on top so the stroke reads
      // clearly against any basemap while the user is drawing.
      map.addSource(DRAW_SOURCE, {
        type: "geojson",
        data: lineStringData([]),
      });
      map.addLayer({
        id: DRAW_LAYER,
        type: "line",
        source: DRAW_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f472b6",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });
      // Direction arrows along the route — a plain line can't show which way
      // to go where a loop closes on itself or an out-and-back doubles back
      // over the same road, so this is on top of everything else drawn.
      map.addSource(ROUTE_ARROWS_SOURCE, {
        type: "geojson",
        data: lineStringData([]),
      });
      map.addImage(ROUTE_ARROW_ICON, createArrowIcon(64), { pixelRatio: 2 });
      map.addLayer({
        id: ROUTE_ARROWS_LAYER,
        type: "symbol",
        source: ROUTE_ARROWS_SOURCE,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 80,
          "icon-image": ROUTE_ARROW_ICON,
          "icon-size": 0.8,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          visibility: "none",
        },
      });
      styleReadyRef.current = true;
      map.fire("routegrade:ready");
    });

    // A user-initiated pan/zoom (originalEvent present) suspends camera
    // follow so the map never fights the runner's fingers.
    map.on("movestart", (event) => {
      if (event.originalEvent && followRef.current) {
        setFollowSuspended(true);
      }
    });

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (drawTimerRef.current !== null) clearTimeout(drawTimerRef.current);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      tipMarkerRef.current = null;
      runnerMarkerRef.current = null;
      styleReadyRef.current = false;
    };
  }, []);

  // Freehand draw mode: while `drawing`, a pointer drag paints a line instead
  // of panning the map. Attaches only when active so normal map gestures are
  // untouched otherwise.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawing) return;

    const canvas = map.getCanvas();
    const setDrawData = (coords: Coord[]) => {
      // Read the live map and tolerate a torn-down style (getSource throws once
      // the map is removed) — the draw source only exists after style load.
      const m = mapRef.current;
      if (!m) return;
      try {
        const src = m.getSource(DRAW_SOURCE) as maplibregl.GeoJSONSource | undefined;
        src?.setData(lineStringData(coords));
      } catch {
        // map mid-teardown; nothing to draw.
      }
    };

    let points: Coord[] = [];
    let active = false;

    const toCoord = (e: PointerEvent): Coord => {
      const rect = canvas.getBoundingClientRect();
      const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      return [lngLat.lng, lngLat.lat];
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      active = true;
      points = [toCoord(e)];
      setDrawData(points);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on stale pointer ids; harmless.
      }
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!active) return;
      points.push(toCoord(e));
      setDrawData(points);
    };
    const onUp = () => {
      if (!active) return;
      active = false;
      if (points.length >= 2) onDrawCompleteRef.current?.(points);
    };

    map.dragPan.disable();
    map.touchZoomRotate.disable();
    map.doubleClickZoom.disable();
    canvas.style.cursor = "crosshair";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.style.cursor = "";
      canvas.style.touchAction = "";
      setDrawData([]);
      // Re-enable gestures only if the map is still alive (not mid-teardown).
      if (mapRef.current) {
        try {
          map.dragPan.enable();
          map.touchZoomRotate.enable();
          map.doubleClickZoom.enable();
        } catch {
          // map already removed; gestures went with it.
        }
      }
    };
  }, [drawing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const cancelPending = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (drawTimerRef.current !== null) {
        clearTimeout(drawTimerRef.current);
        drawTimerRef.current = null;
      }
    };

    const apply = () => {
      cancelPending();
      const coordinates = (geometry?.coordinates ?? []) as Coord[];
      const visible = coordinates.length >= 2;

      const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      const arrowsSource = map.getSource(ROUTE_ARROWS_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!source) return;

      for (const id of ROUTE_LAYERS) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
      // Only ever hidden here, never shown — see the ROUTE_LAYERS comment.
      if (!visible && map.getLayer(ROUTE_DASHED_LAYER)) {
        map.setLayoutProperty(ROUTE_DASHED_LAYER, "visibility", "none");
      }

      markerRef.current?.remove();
      markerRef.current = null;
      tipMarkerRef.current?.remove();
      tipMarkerRef.current = null;

      if (!visible) {
        source.setData(lineStringData([]));
        arrowsSource?.setData(lineStringData([]));
        return;
      }

      // Arrows show the whole route immediately — no need to mirror the
      // draw-in animation below; the runner-telemetry effect narrows this
      // down to "the road ahead" once a run with live position data starts.
      arrowsSource?.setData(lineStringData(coordinates));

      // Start-point marker appears immediately — it anchors the animation.
      const markerElement = document.createElement("div");
      markerElement.className = "start-marker";
      markerElement.innerHTML =
        '<span class="start-marker-ring"></span><span class="start-marker-dot"></span>';
      markerRef.current = new maplibregl.Marker({ element: markerElement })
        .setLngLat(coordinates[0])
        .addTo(map);

      const bounds = coordinates.reduce(
        (acc, coordinate) => acc.extend(coordinate),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
      );
      const desktop = window.matchMedia("(min-width: 640px)").matches;
      // On phones the bottom sheet covers the lower part of the screen, so
      // reserve a slice of the viewport for it — clamped so tiny/landscape
      // screens never get padding bigger than the map itself.
      const mapHeight = map.getContainer().clientHeight;
      const sheetPadding = Math.max(150, Math.min(330, Math.round(mapHeight * 0.42)));
      map.fitBounds(bounds, {
        padding: desktop
          ? { top: 90, bottom: 90, left: 440, right: 80 }
          : { top: 64, bottom: sheetPadding, left: 36, right: 36 },
        maxZoom: 16,
        duration: FIT_DURATION_MS,
        essential: true,
      });

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reducedMotion) {
        source.setData(lineStringData(coordinates));
        return;
      }

      // Draw from the starting point toward the end once the camera has
      // settled. rAF only mutates source data, so panning, zooming, and
      // every control stay fully usable while the line grows.
      source.setData(lineStringData([]));
      const distances = cumulativeDistances(coordinates);
      const total = distances[distances.length - 1];
      const roughKm = total * KM_PER_DEGREE;
      const drawDuration = Math.min(
        DRAW_MAX_MS,
        Math.max(DRAW_MIN_MS, roughKm * DRAW_MS_PER_KM),
      );

      drawTimerRef.current = setTimeout(() => {
        drawTimerRef.current = null;
        if (total <= 0) {
          source.setData(lineStringData(coordinates));
          return;
        }

        // Glowing tip leads the line while it draws, then fades away.
        const tipElement = document.createElement("div");
        tipElement.className = "tip-marker";
        const tipMarker = new maplibregl.Marker({ element: tipElement })
          .setLngLat(coordinates[0])
          .addTo(map);
        tipMarkerRef.current = tipMarker;

        let startedAt: number | null = null;
        const frame = (now: number) => {
          if (startedAt === null) startedAt = now;
          const progress = Math.min(1, (now - startedAt) / drawDuration);
          const eased = easeInOutSine(progress);
          const partial = partialLine(coordinates, distances, eased * total);
          source.setData(lineStringData(partial));
          tipMarker.setLngLat(partial[partial.length - 1]);
          if (progress < 1) {
            animationFrameRef.current = requestAnimationFrame(frame);
          } else {
            animationFrameRef.current = null;
            tipElement.classList.add("tip-marker-done");
            drawTimerRef.current = setTimeout(() => {
              drawTimerRef.current = null;
              if (tipMarkerRef.current === tipMarker) {
                tipMarker.remove();
                tipMarkerRef.current = null;
              }
            }, 600);
          }
        };
        animationFrameRef.current = requestAnimationFrame(frame);
      }, FIT_DURATION_MS + DRAW_DELAY_MS);
    };

    if (styleReadyRef.current) {
      apply();
    } else {
      map.once("routegrade:ready", apply);
    }

    return () => {
      map.off("routegrade:ready", apply);
      cancelPending();
    };
  }, [geometry]);

  // Once a run starts, the route stops "drawing itself in" and becomes a
  // static dashed line instead (the dedicated ROUTE_DASHED_LAYER, swapped in
  // for route-line/route-glow) — progress is shown by the highlight overlay
  // below, not by replaying the intro animation. Both this effect and the
  // geometry effect above depend on `geometry`, and this one is declared
  // later, so whenever geometry changes React runs this one second in the
  // same commit and it gets the final say on layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyFollowStyle = () => {
      if (!map.getLayer("route-line") || !map.getLayer(ROUTE_DASHED_LAYER)) return;
      const coordinates = (geometry?.coordinates ?? []) as Coord[];
      if (coordinates.length < 2) return;

      if (follow) {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        if (drawTimerRef.current !== null) {
          clearTimeout(drawTimerRef.current);
          drawTimerRef.current = null;
        }
        tipMarkerRef.current?.remove();
        tipMarkerRef.current = null;

        const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
        source?.setData(lineStringData(coordinates));

        map.setLayoutProperty("route-line", "visibility", "none");
        map.setLayoutProperty("route-glow", "visibility", "none");
        map.setLayoutProperty(ROUTE_DASHED_LAYER, "visibility", "visible");
      } else {
        map.setLayoutProperty("route-line", "visibility", "visible");
        map.setLayoutProperty("route-glow", "visibility", "visible");
        map.setLayoutProperty(ROUTE_DASHED_LAYER, "visibility", "none");
      }
    };

    if (styleReadyRef.current) {
      applyFollowStyle();
    } else {
      map.once("routegrade:ready", applyFollowStyle);
    }

    return () => {
      map.off("routegrade:ready", applyFollowStyle);
    };
  }, [follow, geometry]);

  // Live run telemetry: runner dot, route-progress highlight, camera follow.
  useEffect(() => {
    followRef.current = follow;
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;

    const traveledSource = map.getSource(TRAVELED_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    const arrowsSource = map.getSource(ROUTE_ARROWS_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (!runner) {
      runnerMarkerRef.current?.remove();
      runnerMarkerRef.current = null;
      traveledSource?.setData(lineStringData([]));
      // Back to showing the whole route's arrows — a run just ended (or
      // never started), so there's no "road ahead of the runner" to narrow
      // to anymore.
      const coordinates = (geometry?.coordinates ?? []) as Coord[];
      if (coordinates.length >= 2) arrowsSource?.setData(lineStringData(coordinates));
      return;
    }

    if (!runnerMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "runner-marker";
      element.innerHTML =
        '<span class="runner-marker-ring"></span><span class="runner-marker-dot"></span>';
      runnerMarkerRef.current = new maplibregl.Marker({ element })
        .setLngLat(runner.position)
        .addTo(map);
    } else {
      runnerMarkerRef.current.setLngLat(runner.position);
    }

    const routeCoordinates = (geometry?.coordinates ?? []) as Coord[];
    const nearest =
      routeCoordinates.length >= 2
        ? projectOntoPath(runner.position, routeCoordinates)
        : null;

    // Highlight the portion of the *route* covered so far (not the raw,
    // jittery GPS trace) — grows from the start as the runner advances.
    // Arrows narrow to the road still ahead: on a loop or out-and-back that
    // doubles back over itself, the already-run direction drops out of the
    // arrows layer entirely once it's behind the runner, so a given stretch
    // never shows both directions at once past wherever they've reached.
    if (nearest) {
      traveledSource?.setData(
        lineStringData(sliceRouteAtDistance(routeCoordinates, nearest.alongPathM)),
      );
      arrowsSource?.setData(
        lineStringData(remainingRouteFromDistance(routeCoordinates, nearest.alongPathM)),
      );
    }

    if (follow && !followSuspended) {
      if (nearest && nearest.distanceToPathM > OFF_ROUTE_M) {
        // Off-route: widen the camera to show both the runner and the
        // nearest point on the route, instead of tight-zooming on the GPS
        // fix alone and stranding the route line off-screen.
        const bounds = new maplibregl.LngLatBounds(
          runner.position,
          runner.position,
        ).extend(nearest.nearestPoint);
        map.fitBounds(bounds, {
          padding: 96,
          maxZoom: FOLLOW_ZOOM,
          duration: 950,
          essential: true,
        });
      } else {
        map.easeTo({
          center: runner.position,
          zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
          duration: 950,
          essential: true,
        });
      }
    }
  }, [runner, follow, followSuspended, geometry]);

  const handleRecenter = () => {
    setFollowSuspended(false);
    const map = mapRef.current;
    if (map && runner) {
      map.easeTo({
        center: runner.position,
        zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
        duration: 600,
        essential: true,
      });
    }
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {followSuspended && follow && runner && (
        <button
          type="button"
          onClick={handleRecenter}
          className="absolute bottom-56 right-3 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-950/85 px-3.5 py-2 text-xs font-semibold text-emerald-300 shadow-lg shadow-black/50 backdrop-blur-xl transition hover:bg-zinc-900 sm:bottom-8"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Re-center
        </button>
      )}
    </div>
  );
}
