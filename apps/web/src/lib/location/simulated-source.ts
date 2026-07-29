import { haversineMeters, pathLengthMeters, type LngLat } from "@/lib/geo";
import type { LocationHandlers, LocationSource } from "./types";

/** ~5:12/km — a friendly training pace. */
export const SIM_SPEED_MPS = 3.2;

/** Point `targetM` metres along `coords`, interpolating within the segment. */
export function pointAtDistanceM(coords: LngLat[], targetM: number): LngLat {
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMeters(coords[i - 1], coords[i]);
    if (walked + seg >= targetM && seg > 0) {
      const t = (targetM - walked) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

/**
 * Walks a synthetic runner along the planned route, for development and for the
 * `?simulate` E2E path. Emits a fix a second with a plausible accuracy so it
 * exercises the same gates as a real GPS stream.
 *
 * `isRunning` is a callback rather than a flag because the source outlives any
 * one phase: it starts during the countdown so the map has a position to centre
 * on, then only advances once the clock is actually running.
 */
export function createSimulatedLocationSource({
  coords,
  isRunning,
  speedMps = SIM_SPEED_MPS,
}: {
  coords: LngLat[];
  isRunning: () => boolean;
  speedMps?: number;
}): LocationSource {
  let timer: ReturnType<typeof setInterval> | null = null;
  let alongM = 0;
  const routeLengthM = pathLengthMeters(coords);

  return {
    kind: "simulated",
    // Not because it truly survives backgrounding — setInterval is throttled
    // or frozen just like watchPosition — but the simulator is a dev tool and
    // marking it false would make the tracker acquire a pointless wake lock.
    tracksInBackground: true,

    async start({ onFix }: LocationHandlers) {
      if (coords.length === 0) return;
      timer = setInterval(() => {
        if (isRunning()) alongM = Math.min(routeLengthM, alongM + speedMps);
        onFix({
          coord: pointAtDistanceM(coords, alongM),
          accuracyM: 5,
          timestampMs: Date.now(),
        });
      }, 1000);
    },

    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
