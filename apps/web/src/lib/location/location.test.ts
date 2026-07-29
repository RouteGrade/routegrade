import { afterEach, describe, expect, it, vi } from "vitest";
import type { LngLat } from "@/lib/geo";
import { createSimulatedLocationSource, pointAtDistanceM } from "./simulated-source";
import { createWebLocationSource } from "./web-source";
import type { LocationError, LocationFix } from "./types";

/** A ~1.1 km east-west leg at the equator, so metres are easy to reason about. */
const LINE: LngLat[] = [
  [0, 0],
  [0.01, 0],
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pointAtDistanceM", () => {
  it("interpolates within a segment", () => {
    const [lng, lat] = pointAtDistanceM(LINE, 556);
    expect(lng).toBeCloseTo(0.005, 3);
    expect(lat).toBeCloseTo(0, 6);
  });

  it("clamps past the end rather than extrapolating off the route", () => {
    expect(pointAtDistanceM(LINE, 99_999)).toEqual([0.01, 0]);
  });

  it("returns the final point for a degenerate single-point path", () => {
    expect(pointAtDistanceM([[3, 4]], 100)).toEqual([3, 4]);
  });
});

describe("createSimulatedLocationSource", () => {
  it("holds position until isRunning goes true, then advances", async () => {
    vi.useFakeTimers();
    const fixes: LocationFix[] = [];
    let running = false;

    const source = createSimulatedLocationSource({
      coords: LINE,
      isRunning: () => running,
      speedMps: 10,
    });
    await source.start({ onFix: (f) => fixes.push(f), onError: () => {} });

    vi.advanceTimersByTime(2000);
    expect(fixes).toHaveLength(2);
    // Still at the start line — a paused runner must not accrue distance.
    expect(fixes[1].coord[0]).toBeCloseTo(0, 6);

    running = true;
    vi.advanceTimersByTime(2000);
    expect(fixes).toHaveLength(4);
    expect(fixes[3].coord[0]).toBeGreaterThan(0);

    await source.stop();
    vi.advanceTimersByTime(5000);
    expect(fixes).toHaveLength(4);
  });

  it("stamps fixes with the clock, not with zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00Z"));
    const fixes: LocationFix[] = [];

    const source = createSimulatedLocationSource({
      coords: LINE,
      isRunning: () => true,
    });
    await source.start({ onFix: (f) => fixes.push(f), onError: () => {} });
    vi.advanceTimersByTime(1000);

    expect(fixes[0].timestampMs).toBe(Date.parse("2026-07-28T10:00:01Z"));
    await source.stop();
  });

  it("emits nothing for an empty route instead of throwing", async () => {
    vi.useFakeTimers();
    const fixes: LocationFix[] = [];
    const source = createSimulatedLocationSource({
      coords: [],
      isRunning: () => true,
    });
    await source.start({ onFix: (f) => fixes.push(f), onError: () => {} });
    vi.advanceTimersByTime(3000);
    expect(fixes).toHaveLength(0);
    await source.stop();
  });
});

describe("createWebLocationSource", () => {
  it("reports the platform's fix timestamp, not arrival time", async () => {
    const fixed = 1_700_000_000_000;
    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition: (onSuccess: (p: unknown) => void) => {
          onSuccess({
            coords: { longitude: 12, latitude: 34, accuracy: 7 },
            timestamp: fixed,
          });
          return 1;
        },
        clearWatch: () => {},
      },
    });

    const fixes: LocationFix[] = [];
    const source = createWebLocationSource();
    await source.start({ onFix: (f) => fixes.push(f), onError: () => {} });

    expect(fixes[0]).toEqual({ coord: [12, 34], accuracyM: 7, timestampMs: fixed });
    expect(source.tracksInBackground).toBe(false);
  });

  it("treats a fix with no accuracy as poor so the tracker's gate drops it", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        watchPosition: (onSuccess: (p: unknown) => void) => {
          onSuccess({ coords: { longitude: 1, latitude: 2 }, timestamp: 5 });
          return 1;
        },
        clearWatch: () => {},
      },
    });

    const fixes: LocationFix[] = [];
    const source = createWebLocationSource();
    await source.start({ onFix: (f) => fixes.push(f), onError: () => {} });
    expect(fixes[0].accuracyM).toBe(99);
  });

  it("distinguishes a denied permission from a missing signal", async () => {
    const errors: LocationError[] = [];
    const emit = (code: number) => {
      vi.stubGlobal("navigator", {
        geolocation: {
          watchPosition: (_ok: unknown, onError: (e: unknown) => void) => {
            onError({ code, PERMISSION_DENIED: 1, message: "x" });
            return 1;
          },
          clearWatch: () => {},
        },
      });
      return createWebLocationSource().start({
        onFix: () => {},
        onError: (e) => errors.push(e),
      });
    };

    await emit(1);
    await emit(2);
    expect(errors.map((e) => e.kind)).toEqual(["permission-denied", "unavailable"]);
  });

  it("reports unsupported when the browser has no geolocation at all", async () => {
    vi.stubGlobal("navigator", {});
    const errors: LocationError[] = [];
    await createWebLocationSource().start({
      onFix: () => {},
      onError: (e) => errors.push(e),
    });
    expect(errors[0].kind).toBe("unsupported");
  });

  it("survives stop() before start() and a double stop", async () => {
    const clearWatch = vi.fn();
    vi.stubGlobal("navigator", {
      geolocation: { watchPosition: () => 1, clearWatch },
    });

    const source = createWebLocationSource();
    await source.stop();
    // Already stopped: starting must not leave a watch running behind us.
    await source.start({ onFix: () => {}, onError: () => {} });
    await source.stop();
    await source.stop();
    expect(clearWatch).not.toHaveBeenCalled();
  });
});
