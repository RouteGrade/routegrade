import type { LngLat } from "@/lib/geo";
import { createNativeLocationSource } from "./native-source";
import { createSimulatedLocationSource } from "./simulated-source";
import type { LocationSource } from "./types";
import { createWebLocationSource } from "./web-source";

export { createNativeLocationSource, openLocationSettings } from "./native-source";
export { createSimulatedLocationSource, pointAtDistanceM, SIM_SPEED_MPS } from "./simulated-source";
export { createWebLocationSource } from "./web-source";
export type {
  LocationError,
  LocationErrorKind,
  LocationFix,
  LocationHandlers,
  LocationSource,
} from "./types";

/**
 * True when the bundle is running inside the native Capacitor shell rather than
 * a browser tab. Capacitor sets this global before any app code executes.
 */
export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/**
 * Pick the location source for this run.
 *
 * Order matters. An explicit `?simulate` beats everything, so the simulator
 * stays usable inside the native shell — that is how you exercise the run
 * screen on device without going outside. Otherwise the native shell gets real
 * background tracking, and a browser tab gets the foreground-only web source,
 * which is the best that platform allows.
 */
export function selectLocationSource({
  coords,
  isRunning,
  simulate,
}: {
  coords: LngLat[];
  isRunning: () => boolean;
  simulate?: boolean;
}): LocationSource {
  const forced =
    simulate ??
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("simulate"));

  if (forced) return createSimulatedLocationSource({ coords, isRunning });
  if (isNativePlatform()) return createNativeLocationSource();

  return createWebLocationSource();
}
