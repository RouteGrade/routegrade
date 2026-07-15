"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, LineString } from "geojson";
import sampleRouteJson from "../fixtures/sample-route.json";

const sampleRoute = sampleRouteJson as FeatureCollection<LineString>;
const routeCoordinates = sampleRoute.features[0].geometry.coordinates as [
  number,
  number,
][];

const DOWNTOWN_TORONTO: [number, number] = [-79.3832, 43.6532];
const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://demotiles.maplibre.org/style.json";

const ROUTE_LAYERS = ["route-glow", "route-line"] as const;

export default function RouteMap({ showRoute }: { showRoute: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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

    const markerElement = document.createElement("div");
    markerElement.className = "start-marker";
    markerElement.innerHTML =
      '<span class="start-marker-ring"></span><span class="start-marker-dot"></span>';
    new maplibregl.Marker({ element: markerElement })
      .setLngLat(routeCoordinates[0])
      .addTo(map);

    map.on("load", () => {
      map.addSource("sample-route", {
        type: "geojson",
        data: sampleRoute,
        lineMetrics: true,
      });
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "sample-route",
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
        source: "sample-route",
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
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyVisibility = () => {
      for (const id of ROUTE_LAYERS) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", showRoute ? "visible" : "none");
        }
      }
      if (showRoute) {
        const bounds = routeCoordinates.reduce(
          (acc, coordinate) => acc.extend(coordinate),
          new maplibregl.LngLatBounds(routeCoordinates[0], routeCoordinates[0]),
        );
        const desktop = window.matchMedia("(min-width: 640px)").matches;
        map.fitBounds(bounds, {
          padding: desktop
            ? { top: 90, bottom: 90, left: 440, right: 80 }
            : { top: 60, bottom: 220, left: 40, right: 40 },
          duration: 1800,
          essential: true,
        });
      }
    };

    if (map.isStyleLoaded()) {
      applyVisibility();
    } else {
      map.once("load", applyVisibility);
    }
  }, [showRoute]);

  return <div ref={containerRef} className="h-full w-full" />;
}
