"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LineString } from "geojson";

const DOWNTOWN_TORONTO: [number, number] = [-79.3832, 43.6532];
const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://demotiles.maplibre.org/style.json";

const ROUTE_SOURCE = "active-route";
const ROUTE_LAYERS = ["route-glow", "route-line"] as const;

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

export type RouteMapProps = {
  /** GeoJSON LineString of the route to draw, or null to hide the route. */
  geometry: LineString | null;
};

export default function RouteMap({ geometry }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const tipMarkerRef = useRef<maplibregl.Marker | null>(null);
  const styleReadyRef = useRef(false);
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
      styleReadyRef.current = true;
      map.fire("routegrade:ready");
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
      styleReadyRef.current = false;
    };
  }, []);

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
      if (!source) return;

      for (const id of ROUTE_LAYERS) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }

      markerRef.current?.remove();
      markerRef.current = null;
      tipMarkerRef.current?.remove();
      tipMarkerRef.current = null;

      if (!visible) {
        source.setData(lineStringData([]));
        return;
      }

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

  return <div ref={containerRef} className="h-full w-full" />;
}
