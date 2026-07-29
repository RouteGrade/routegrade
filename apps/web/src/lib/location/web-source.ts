import type { LngLat } from "@/lib/geo";
import type { LocationHandlers, LocationSource } from "./types";

/**
 * Browser geolocation via `watchPosition`.
 *
 * Foreground only. iOS suspends page JavaScript the moment the screen locks or
 * the runner switches apps, and no web API lifts that — a run tracked here
 * loses everything between lock and unlock. This source is correct for the
 * installed web app (planning, dogfooding, a run with the phone in your hand)
 * and is the reason the native source exists for shipping.
 */
export function createWebLocationSource(): LocationSource {
  let watchId: number | null = null;
  let stopped = false;

  return {
    kind: "web",
    tracksInBackground: false,

    async start({ onFix, onError }: LocationHandlers) {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        onError({ kind: "unsupported", detail: "navigator.geolocation missing" });
        return;
      }
      if (stopped) return;

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          onFix({
            coord: [position.coords.longitude, position.coords.latitude] as LngLat,
            // A fix with no stated accuracy is treated as bad rather than
            // perfect, so the tracker's accuracy gate discards it.
            accuracyM: position.coords.accuracy ?? 99,
            // watchPosition already reports when the fix was taken; prefer it
            // over Date.now() so a delayed callback doesn't skew pace.
            timestampMs: position.timestamp ?? Date.now(),
          });
        },
        (error) => {
          onError(
            error.code === error.PERMISSION_DENIED
              ? { kind: "permission-denied", detail: error.message }
              : { kind: "unavailable", detail: error.message },
          );
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
      );
    },

    async stop() {
      stopped = true;
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    },
  };
}
