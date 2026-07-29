import { registerPlugin } from "@capacitor/core";
import type {
  BackgroundGeolocationPlugin,
  CallbackError,
  Location,
} from "@capacitor-community/background-geolocation";
import type { LngLat } from "@/lib/geo";
import type { LocationHandlers, LocationSource } from "./types";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  "BackgroundGeolocation",
);

/**
 * Metres of movement before iOS reports a new fix.
 *
 * Zero would report continuously and flatten the battery on a long run; the
 * tracker already discards anything under ~2.5 m as jitter, so filtering below
 * that in native code costs nothing and saves a lot of radio time.
 */
const DISTANCE_FILTER_M = 5;

/**
 * Real background tracking, via the native CoreLocation bridge.
 *
 * The one non-obvious requirement: `backgroundMessage` must be set, or the
 * plugin only guarantees foreground updates — the very thing this source exists
 * to fix. It is the Android notification text and unused on iOS, but its
 * presence is what opts both platforms into background delivery.
 *
 * Fixes arrive buffered here. iOS hands over everything it recorded while the
 * app was suspended in one burst on resume, which is why `LocationFix` carries
 * the device's own `time` rather than an arrival timestamp.
 */
export function createNativeLocationSource(): LocationSource {
  let watcherId: string | null = null;
  let stopped = false;

  return {
    kind: "native",
    tracksInBackground: true,

    async start({ onFix, onError }: LocationHandlers) {
      if (stopped) return;

      try {
        const id = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Recording your run.",
            backgroundTitle: "RouteGrade",
            requestPermissions: true,
            // Never accept a cached fix: a stale position at the start line
            // would be counted as real distance the moment the runner moves.
            stale: false,
            distanceFilter: DISTANCE_FILTER_M,
          },
          (position?: Location, error?: CallbackError) => {
            if (error) {
              onError(
                error.code === "NOT_AUTHORIZED"
                  ? { kind: "permission-denied", detail: error.message }
                  : { kind: "unavailable", detail: error.message },
              );
              return;
            }
            if (!position) return;

            onFix({
              coord: [position.longitude, position.latitude] as LngLat,
              accuracyM: position.accuracy,
              // `time` is nullable in the plugin's contract. Falling back to
              // now is right for a live fix and harmless for a buffered one:
              // the tracker's out-of-order guard drops anything that would
              // compute a negative interval.
              timestampMs: position.time ?? Date.now(),
            });
          },
        );

        // stop() may have landed while addWatcher was in flight — the tracker
        // unmounts on a mid-acquire route change more often than you'd think.
        if (stopped) {
          await BackgroundGeolocation.removeWatcher({ id });
          return;
        }
        watcherId = id;
      } catch (cause) {
        onError({
          kind: "unavailable",
          detail: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },

    async stop() {
      stopped = true;
      if (watcherId === null) return;

      const id = watcherId;
      watcherId = null;
      try {
        await BackgroundGeolocation.removeWatcher({ id });
      } catch {
        // Nothing useful to do — the run is already over and leaving the
        // watcher up must not surface an error over the finish screen.
      }
    },
  };
}

/**
 * Sends the runner to iOS Settings for this app. Only worth offering after a
 * `permission-denied`: once location is denied, iOS will not prompt again and
 * the in-app request silently does nothing.
 */
export async function openLocationSettings(): Promise<void> {
  try {
    await BackgroundGeolocation.openSettings();
  } catch {
    // Best-effort.
  }
}
