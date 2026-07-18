"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/authenticated-client";
import type { LineStringGeometry } from "@/lib/api/routes-client";
import { saveRun, type RunSplit } from "@/lib/api/runs-client";
import {
  formatDuration,
  formatPace,
  haversineMeters,
  pathLengthMeters,
  projectOntoPath,
  spokenPace,
  type LngLat,
} from "@/lib/geo";

/** Route metadata the tracker needs — planned and saved routes both satisfy it. */
export type RunnableRoute = {
  id: string;
  name: string;
  geometry: LineStringGeometry;
  distance_km: number;
};

export type RunTelemetry = {
  position: LngLat;
  traveled: LngLat[];
};

type Phase = "countdown" | "running" | "paused" | "finished";

// GPS quality gates: ignore fixes worse than this for distance math, ignore
// sub-jitter movement, and drop teleport glitches.
const MAX_ACCURACY_M = 60;
const MIN_STEP_M = 2.5;
const MAX_SPEED_MPS = 10;

// Off-route hysteresis: alert past 50 m, recover under 30 m.
const OFF_ROUTE_M = 50;
const BACK_ON_ROUTE_M = 30;

// Rolling window for "current pace".
const PACE_WINDOW_MS = 40_000;

const SIM_SPEED_MPS = 3.2; // ~5:12/km, a friendly training pace

/**
 * iOS/Safari only allow speech after a user gesture. Call this from the
 * click handler that launches the tracker so later cues are audible.
 */
export function primeSpeech() {
  try {
    const utterance = new SpeechSynthesisUtterance("");
    utterance.volume = 0;
    window.speechSynthesis?.speak(utterance);
  } catch {
    // Speech is a nice-to-have; never block the run on it.
  }
}

/** Point `target` meters along the path — powers the dev simulation mode. */
function pointAtDistanceM(coords: LngLat[], target: number): LngLat {
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMeters(coords[i - 1], coords[i]);
    if (walked + seg >= target && seg > 0) {
      const t = (target - walked) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
    walked += seg;
  }
  return coords[coords.length - 1];
}

export default function RunTracker({
  route,
  isAuthenticated,
  onExit,
  onTelemetry,
}: {
  route: RunnableRoute;
  isAuthenticated: boolean;
  onExit: () => void;
  onTelemetry: (telemetry: RunTelemetry | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("countdown");
  const [countdown, setCountdown] = useState(3);
  const [muted, setMuted] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [currentPaceS, setCurrentPaceS] = useState<number | null>(null);
  const [alongRouteM, setAlongRouteM] = useState(0);
  const [splits, setSplits] = useState<RunSplit[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const routeCoords = useMemo(
    () => route.geometry.coordinates as LngLat[],
    [route.geometry],
  );
  const routeLengthM = useMemo(() => pathLengthMeters(routeCoords), [routeCoords]);

  // Mutable tracking state lives in refs: GPS callbacks fire outside React's
  // render cycle and must never read stale closures.
  const phaseRef = useRef<Phase>("countdown");
  const mutedRef = useRef(false);
  const lastFixRef = useRef<{ coord: LngLat; timeMs: number } | null>(null);
  const distanceRef = useRef(0);
  const traveledRef = useRef<LngLat[]>([]);
  const samplesRef = useRef<{ timeMs: number; distanceM: number }[]>([]);
  const splitsRef = useRef<RunSplit[]>([]);
  const offRouteRef = useRef(false);
  const lastOffRouteSpokenRef = useRef(0);
  const movingMsRef = useRef(0);
  const resumedAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const runIdRef = useRef<string>("");
  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const simulate = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const speak = (text: string) => {
    if (mutedRef.current) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      window.speechSynthesis?.speak(utterance);
    } catch {
      // Ignore — speech is optional.
    }
  };

  const movingSeconds = () => {
    const live =
      phaseRef.current === "running" && resumedAtRef.current !== null
        ? performance.now() - resumedAtRef.current
        : 0;
    return (movingMsRef.current + live) / 1000;
  };

  /** Single funnel for every position fix, real or simulated. */
  const handleFix = (coord: LngLat, accuracyM: number) => {
    const nowMs = performance.now();
    const last = lastFixRef.current;
    lastFixRef.current = { coord, timeMs: nowMs };

    // Always show where the runner is, even fixes we won't count.
    onTelemetry({ position: coord, traveled: [...traveledRef.current] });

    if (phaseRef.current !== "running") return;
    if (accuracyM > MAX_ACCURACY_M) return;

    if (last) {
      const stepM = haversineMeters(last.coord, coord);
      const dtS = (nowMs - last.timeMs) / 1000;
      if (stepM < Math.max(MIN_STEP_M, accuracyM * 0.25)) return; // GPS jitter
      if (dtS > 0 && stepM / dtS > MAX_SPEED_MPS) return; // teleport glitch

      distanceRef.current += stepM;
    }

    traveledRef.current.push(coord);
    samplesRef.current.push({ timeMs: nowMs, distanceM: distanceRef.current });
    // Trim samples we'll never look at again.
    while (
      samplesRef.current.length > 2 &&
      samplesRef.current[0].timeMs < nowMs - PACE_WINDOW_MS - 5_000
    ) {
      samplesRef.current.shift();
    }

    setDistanceM(distanceRef.current);
    onTelemetry({ position: coord, traveled: [...traveledRef.current] });

    // Current pace over the rolling window.
    const windowStart = samplesRef.current.find(
      (s) => s.timeMs >= nowMs - PACE_WINDOW_MS,
    );
    if (windowStart && windowStart.timeMs < nowMs - 5_000) {
      const dd = distanceRef.current - windowStart.distanceM;
      const dt = (nowMs - windowStart.timeMs) / 1000;
      setCurrentPaceS(dd > 15 ? (dt / dd) * 1000 : null);
    }

    // Kilometer splits.
    while (distanceRef.current >= (splitsRef.current.length + 1) * 1000) {
      const km = splitsRef.current.length + 1;
      const elapsed = Math.round(movingSeconds());
      const previous = splitsRef.current.reduce((sum, s) => sum + s.duration_s, 0);
      const split = { km, duration_s: Math.max(1, elapsed - previous) };
      splitsRef.current.push(split);
      setSplits([...splitsRef.current]);
      speak(`Kilometer ${km}. ${spokenPace(split.duration_s)}.`);
    }

    // Route guidance: progress + off-route hysteresis.
    if (routeLengthM > 0) {
      const { distanceToPathM, alongPathM } = projectOntoPath(coord, routeCoords);
      setAlongRouteM(alongPathM);
      if (!offRouteRef.current && distanceToPathM > OFF_ROUTE_M) {
        offRouteRef.current = true;
        setOffRoute(true);
        if (nowMs - lastOffRouteSpokenRef.current > 15_000) {
          lastOffRouteSpokenRef.current = nowMs;
          speak("You're off the route. Head back to the highlighted path.");
        }
      } else if (offRouteRef.current && distanceToPathM < BACK_ON_ROUTE_M) {
        offRouteRef.current = false;
        setOffRoute(false);
        speak("Back on route. Nice.");
      }
    }
  };

  // GPS watch (or simulation) runs for the whole tracker lifetime so the fix
  // is already warm when the countdown hits zero.
  useEffect(() => {
    runIdRef.current = crypto.randomUUID();
    simulate.current = new URLSearchParams(window.location.search).has("simulate");

    if (simulate.current) {
      let simAlongM = 0;
      const timer = setInterval(() => {
        if (phaseRef.current === "running") {
          simAlongM = Math.min(routeLengthM, simAlongM + SIM_SPEED_MPS);
        }
        handleFix(pointAtDistanceM(routeCoords, simAlongM), 5);
      }, 1000);
      return () => clearInterval(timer);
    }

    if (!("geolocation" in navigator)) {
      // Deferred so the effect body itself stays setState-free.
      const timer = setTimeout(
        () => setGpsError("Location isn't available in this browser."),
        0,
      );
      return () => clearTimeout(timer);
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setGpsError(null);
        handleFix(
          [position.coords.longitude, position.coords.latitude],
          position.coords.accuracy ?? 99,
        );
      },
      (error) => {
        setGpsError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied — allow it to track your run."
            : "Waiting for a GPS signal…",
        );
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
    );
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown → running. "GO" lingers for a beat before the clock starts.
  useEffect(() => {
    if (phase !== "countdown") return;
    const timer = setTimeout(
      () => {
        if (countdown > 0) {
          setCountdown(countdown - 1);
          return;
        }
        startedAtRef.current = new Date().toISOString();
        resumedAtRef.current = performance.now();
        setPhase("running");
        speak(`Run started. ${route.distance_km.toFixed(1)} kilometers ahead. Good luck!`);
      },
      countdown === 0 ? 800 : 1000,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  // Moving-time clock.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => setElapsedS(Math.floor(movingSeconds())), 500);
    return () => clearInterval(timer);
  }, [phase]);

  // Keep the screen awake mid-run; reacquire when the tab comes back.
  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        const lock = await nav.wakeLock?.request("screen");
        if (lock) {
          if (cancelled) await lock.release();
          else wakeLockRef.current = lock;
        }
      } catch {
        // Wake lock is best-effort (denied on low battery, etc.).
      }
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [phase]);

  const pauseRun = () => {
    if (resumedAtRef.current !== null) {
      movingMsRef.current += performance.now() - resumedAtRef.current;
      resumedAtRef.current = null;
    }
    setPhase("paused");
    speak("Run paused.");
  };

  const resumeRun = () => {
    resumedAtRef.current = performance.now();
    setPhase("running");
    speak("Resuming.");
  };

  const finishRun = () => {
    if (phaseRef.current === "running" && resumedAtRef.current !== null) {
      movingMsRef.current += performance.now() - resumedAtRef.current;
      resumedAtRef.current = null;
    }
    setElapsedS(Math.floor(movingMsRef.current / 1000));
    setPhase("finished");
    const km = distanceRef.current / 1000;
    speak(
      km >= 0.05
        ? `Run complete. ${km.toFixed(2)} kilometers in ${formatDuration(
            movingMsRef.current / 1000,
          ).replace(/:/g, " ")}. Great work!`
        : "Run complete.",
    );
  };

  const confirmExit = () => {
    if (phase === "running" || phase === "paused") {
      if (!window.confirm("Leave without finishing? This run won't be saved.")) return;
    }
    onExit();
  };

  const handleSave = async () => {
    if (saving || saved) return;
    setSaving(true);
    setSaveError(null);
    const durationS = Math.max(1, Math.round(movingMsRef.current / 1000));
    const km = distanceRef.current / 1000;
    try {
      await saveRun(runIdRef.current, {
        route_id: /^[0-9a-f-]{36}$/i.test(route.id) ? route.id : null,
        route_name: route.name,
        started_at: startedAtRef.current ?? new Date().toISOString(),
        duration_s: durationS,
        distance_km: Number(km.toFixed(3)),
        avg_pace_s_per_km: km > 0.05 ? Math.round(durationS / km) : null,
        splits: splitsRef.current,
        path:
          traveledRef.current.length >= 2
            ? { type: "LineString", coordinates: traveledRef.current }
            : null,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.status === 401
          ? "Your session expired — sign in again to save."
          : "Couldn't save this run. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const km = distanceM / 1000;
  const avgPaceS = km > 0.05 ? elapsedS / km : null;
  const progress = routeLengthM > 0 ? Math.min(1, alongRouteM / routeLengthM) : 0;
  const remainingKm = Math.max(0, (routeLengthM - alongRouteM) / 1000);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Countdown takes the whole stage, NRC style */}
      {phase === "countdown" && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-sm">
          <p className="mb-2 text-sm font-medium uppercase tracking-widest text-zinc-400">
            {route.name}
          </p>
          <span
            key={countdown}
            className="run-countdown font-display text-[9rem] font-extrabold leading-none text-transparent bg-linear-to-br from-emerald-400 to-cyan-400 bg-clip-text"
          >
            {countdown === 0 ? "GO" : countdown}
          </span>
          <button
            type="button"
            onClick={onExit}
            className="mt-10 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      )}

      {phase !== "countdown" && (
        <>
          {/* Top bar: exit, route progress, mute */}
          <div className="pointer-events-auto absolute inset-x-0 top-0 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <div className="mx-auto flex max-w-md items-center gap-2">
              <button
                type="button"
                onClick={confirmExit}
                aria-label="Exit run"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-950/80 text-zinc-300 backdrop-blur-xl transition hover:bg-zinc-900"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="min-w-0 flex-1 rounded-full border border-white/10 bg-zinc-950/80 px-4 py-2 backdrop-blur-xl">
                <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                  <span className="truncate text-zinc-300">{route.name}</span>
                  <span className="shrink-0 tabular-nums text-emerald-300">
                    {remainingKm.toFixed(1)} km left
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-emerald-400 to-cyan-400 transition-[width] duration-700"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute audio cues" : "Mute audio cues"}
                aria-pressed={muted}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-950/80 text-zinc-300 backdrop-blur-xl transition hover:bg-zinc-900"
              >
                {muted ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M11 5 6 9H2v6h4l5 4z" />
                    <line x1="22" x2="16" y1="9" y2="15" />
                    <line x1="16" x2="22" y1="9" y2="15" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M11 5 6 9H2v6h4l5 4z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    <path d="M19 5a10 10 0 0 1 0 14" />
                  </svg>
                )}
              </button>
            </div>

            {(offRoute || gpsError) && phase !== "finished" && (
              <div
                role="alert"
                className={`mx-auto mt-2 w-fit max-w-md rounded-full border px-4 py-1.5 text-xs font-semibold backdrop-blur-xl ${
                  gpsError
                    ? "border-amber-400/30 bg-amber-400/15 text-amber-300"
                    : "border-rose-500/30 bg-rose-500/15 text-rose-300"
                }`}
              >
                {gpsError ?? "Off route — head back to the highlighted path"}
              </div>
            )}
          </div>

          {/* Live stats + controls */}
          {phase !== "finished" && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-0 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-zinc-950/85 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                <div className="text-center">
                  <span className="font-display text-6xl font-extrabold tabular-nums tracking-tight text-white">
                    {km.toFixed(2)}
                  </span>
                  <span className="ml-2 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                    km
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-1.5 text-center">
                  {[
                    { label: "Time", value: formatDuration(elapsedS) },
                    { label: "Avg pace", value: `${formatPace(avgPaceS)} /km` },
                    { label: "Pace", value: `${formatPace(currentPaceS)} /km` },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-white/10 bg-white/5 py-2">
                      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</dt>
                      <dd className="text-sm font-semibold tabular-nums text-white">{stat.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 flex items-center justify-center gap-3">
                  {phase === "running" ? (
                    <button
                      type="button"
                      onClick={pauseRun}
                      aria-label="Pause run"
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-emerald-500/30 transition active:scale-95"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={finishRun}
                        aria-label="Finish run"
                        className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-rose-500/60 bg-rose-500/15 text-rose-300 transition hover:bg-rose-500/25 active:scale-95"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                          <rect x="6" y="6" width="12" height="12" rx="1.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={resumeRun}
                        aria-label="Resume run"
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-emerald-500/30 transition active:scale-95"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-6 w-6">
                          <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                {phase === "paused" && (
                  <p className="mt-2 text-center text-[11px] text-zinc-500">
                    Paused — press stop to finish your run
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Summary */}
          {phase === "finished" && (
            <div className="pointer-events-auto absolute inset-0 flex items-end justify-center overflow-y-auto bg-zinc-950/70 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center">
              <section className="animate-float-in w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/90 p-6 shadow-2xl shadow-black/60 backdrop-blur-xl">
                <header className="text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-400">
                    Run complete
                  </p>
                  <h2 className="mt-1 truncate font-display text-lg font-bold text-white">
                    {route.name}
                  </h2>
                </header>

                <div className="mt-4 text-center">
                  <span className="font-display text-6xl font-extrabold tabular-nums tracking-tight text-transparent bg-linear-to-br from-emerald-400 to-lime-400 bg-clip-text">
                    {km.toFixed(2)}
                  </span>
                  <span className="ml-2 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                    km
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-1.5 text-center">
                  {[
                    { label: "Time", value: formatDuration(elapsedS) },
                    { label: "Avg pace", value: `${formatPace(avgPaceS)} /km` },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-white/10 bg-white/5 py-2.5">
                      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</dt>
                      <dd className="text-base font-semibold tabular-nums text-white">{stat.value}</dd>
                    </div>
                  ))}
                </dl>

                {splits.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Splits
                    </h3>
                    <ul className="mt-1.5 max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-white/5">
                      {splits.map((split) => (
                        <li
                          key={split.km}
                          className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-xs last:border-b-0"
                        >
                          <span className="text-zinc-400">km {split.km}</span>
                          <span className="font-semibold tabular-nums text-white">
                            {formatPace(split.duration_s)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-2">
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || saved}
                      className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                        saved
                          ? "cursor-default border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                          : "bg-linear-to-r from-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-emerald-500/20 hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                      }`}
                    >
                      {saved ? (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          Saved to your account
                        </>
                      ) : saving ? (
                        "Saving…"
                      ) : (
                        "Save this run"
                      )}
                    </button>
                  ) : (
                    <Link
                      href="/login?next=/"
                      className="flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
                    >
                      Sign in to save this run
                    </Link>
                  )}
                  {saveError && (
                    <p role="alert" className="text-center text-xs text-rose-400">
                      {saveError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={onExit}
                    className="flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-300 transition hover:bg-white/10"
                  >
                    Done
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
