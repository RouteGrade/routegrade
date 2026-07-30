"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/authenticated-client";
import { saveRunRating } from "@/lib/api/run-ratings-client";
import type { LineStringGeometry, Preference } from "@/lib/api/routes-client";
import { saveRun, type RunSplit } from "@/lib/api/runs-client";
import {
  formatDuration,
  formatPace,
  OFF_ROUTE_M,
  pathLengthMeters,
  projectOntoPath,
  spokenPace,
  type LngLat,
} from "@/lib/geo";
import {
  selectLocationSource,
  type LocationError,
  type LocationFix,
  type LocationSource,
} from "@/lib/location";
import {
  applyFix,
  initialDistanceState,
  type DistanceState,
} from "@/lib/run-distance";
import type { Grade } from "@/lib/scorecard";
import { RunShareCard } from "./run-share-card";
import { EMPTY_RATING, hasRating, RunRating, type RatingDraft } from "./run-rating";

/** Route metadata the tracker needs — planned and saved routes both satisfy it. */
export type RunnableRoute = {
  id: string;
  name: string;
  geometry: LineStringGeometry;
  distance_km: number;
  /** Grade snapshot — present for graded routes, enables rating + scorecard. */
  grade?: Grade;
  score?: number;
  elevation_gain_m?: number;
  intersections_per_km?: number | null;
  sidewalk_coverage?: number | null;
  preference?: Preference;
};

export type RunTelemetry = {
  position: LngLat;
};

type Phase = "countdown" | "running" | "paused" | "finished";

// Off-route hysteresis: alert past 50 m (OFF_ROUTE_M, shared with the map's
// camera-follow logic), recover under 30 m.
const BACK_ON_ROUTE_M = 30;

// Rolling window for "current pace".
const PACE_WINDOW_MS = 40_000;

/** Runner-facing copy for each way a location source can fail. */
const GPS_ERROR_COPY: Record<LocationError["kind"], string> = {
  "permission-denied": "Location permission denied — allow it to track your run.",
  unsupported: "Location isn't available in this browser.",
  unavailable: "Waiting for a GPS signal…",
};

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
  const [rating, setRating] = useState<RatingDraft>(EMPTY_RATING);
  // Snapshot of the ran GPS trace, taken at finish for the shareable card.
  const [finishedPath, setFinishedPath] = useState<LngLat[]>([]);

  const routeCoords = useMemo(
    () => route.geometry.coordinates as LngLat[],
    [route.geometry],
  );
  const routeLengthM = useMemo(() => pathLengthMeters(routeCoords), [routeCoords]);

  // Mutable tracking state lives in refs: GPS callbacks fire outside React's
  // render cycle and must never read stale closures.
  const phaseRef = useRef<Phase>("countdown");
  const mutedRef = useRef(false);
  const distanceStateRef = useRef<DistanceState>(initialDistanceState());
  // Timestamp of the newest fix we've taken, for the ordering guard in
  // handleFix. Distinct from the accumulator's anchor, which deliberately stays
  // put on a rejected fix — see lib/run-distance.ts.
  const lastFixTimeRef = useRef<number | null>(null);
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
  const sourceRef = useRef<LocationSource | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  // Drives whether the run needs a screen wake lock. Starts true so we never
  // acquire one before knowing which source we got; the effect below corrects
  // it as soon as the source is chosen.
  const [tracksInBackground, setTracksInBackground] = useState(true);

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

  /**
   * Single funnel for every position fix, whatever produced it.
   *
   * Timed by `fix.timestampMs` — when the device took the reading — and never
   * by arrival time. A native background source hands over a whole buffered
   * batch at once when iOS resumes the app, and timing those by arrival would
   * squeeze minutes of running into one instant: every step would look like a
   * teleport and get thrown out by the speed guard in lib/run-distance.
   */
  const handleFix = ({ coord, accuracyM, timestampMs: nowMs }: LocationFix) => {
    // Out-of-order delivery is possible once fixes are buffered; an older fix
    // than the one we already took would compute a negative interval.
    const lastTimeMs = lastFixTimeRef.current;
    if (lastTimeMs !== null && nowMs < lastTimeMs) return;
    lastFixTimeRef.current = nowMs;

    // Always show where the runner is, even fixes we won't count.
    onTelemetry({ position: coord });

    if (phaseRef.current !== "running") return;

    // Accumulation lives in lib/run-distance.ts so it can be tested — see the
    // note there on why a rejected fix must never become the anchor.
    const { state, verdict } = applyFix(distanceStateRef.current, {
      coord,
      accuracyM,
      timeMs: nowMs,
    });
    distanceStateRef.current = state;
    // A rejected fix contributes nothing downstream either: no trace point, no
    // pace sample, no split check.
    if (verdict !== "counted" && verdict !== "anchored") return;
    distanceRef.current = state.distanceM;

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
    onTelemetry({ position: coord });

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

  // The location stream runs for the whole tracker lifetime, not just while
  // the clock is going, so the first fix is already warm when the countdown
  // hits zero and the map has somewhere to point during it.
  useEffect(() => {
    runIdRef.current = crypto.randomUUID();

    const source = selectLocationSource({
      coords: routeCoords,
      isRunning: () => phaseRef.current === "running",
    });
    sourceRef.current = source;
    setTracksInBackground(source.tracksInBackground);

    source.start({
      onFix: (fix) => {
        setGpsError(null);
        handleFix(fix);
      },
      onError: (error) => setGpsError(GPS_ERROR_COPY[error.kind]),
    });

    return () => {
      sourceRef.current = null;
      source.stop();
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
  //
  // Only for sources that die when the page is suspended. It's a stopgap, not
  // background tracking: it keeps fixes coming while the runner watches the
  // screen, at a real battery cost, and still loses the run the moment they
  // pocket the phone. A source that tracks in the background makes it pure
  // cost, so it's skipped there.
  useEffect(() => {
    if (phase !== "running" || tracksInBackground) return;
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
  }, [phase, tracksInBackground]);

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
    setFinishedPath(traveledRef.current.slice());
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
    const routeId = /^[0-9a-f-]{36}$/i.test(route.id) ? route.id : null;
    try {
      await saveRun(runIdRef.current, {
        route_id: routeId,
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
      // If the runner rated the route, persist that alongside the run. Keyed on
      // the same run id, so it lands on the run we just saved. A rating failure
      // must not fail the run save the runner just confirmed.
      if (hasRating(rating)) {
        try {
          await saveRunRating(runIdRef.current, {
            overall: rating.overall,
            grade_match: rating.gradeMatch,
            tags: rating.tags,
            route_id: routeId,
            graded_score: route.score ?? null,
            graded_grade: route.grade ?? null,
            preference: route.preference ?? null,
          });
        } catch {
          // Swallow — the run itself saved; the rating is best-effort.
        }
      }
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
  // The route the runner actually ran, for the shareable card. Falls back to
  // the planned geometry when the GPS trace is too sparse (e.g. weak signal).
  const runPath = finishedPath.length >= 2 ? finishedPath : routeCoords;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Countdown takes the whole stage, NRC style */}
      {phase === "countdown" && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-canvas/90 backdrop-blur-sm">
          <p className="rg-label mb-3">{route.name}</p>
          <span key={countdown} className="run-countdown rg-display text-[9rem] text-accent">
            {countdown === 0 ? "GO" : countdown}
          </span>
          <button type="button" onClick={onExit} className="rg-btn rg-btn-secondary mt-10">
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
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink transition hover:bg-raised"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="min-w-0 flex-1 rounded-full border border-hairline bg-canvas px-4 py-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                  <span className="truncate text-ink">{route.name}</span>
                  <span className="shrink-0 tabular-nums text-accent">
                    {remainingKm.toFixed(1)} km left
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-700"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute audio cues" : "Mute audio cues"}
                aria-pressed={muted}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink transition hover:bg-raised"
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

            {/* Two different states, two different jobs: a GPS problem is
                something to know about, being off route is something to act on,
                so only the latter takes the reserved danger colour. */}
            {(offRoute || gpsError) && phase !== "finished" && (
              <div
                role="alert"
                className={`mx-auto mt-2 w-fit max-w-md rounded-full border px-4 py-1.5 text-xs font-semibold ${
                  gpsError
                    ? "border-hairline-strong bg-raised text-muted"
                    : "border-danger/30 bg-danger-wash text-danger"
                }`}
              >
                {gpsError ?? "Off route — head back to the highlighted path"}
              </div>
            )}
          </div>

          {/* Live stats + controls */}
          {phase !== "finished" && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-0 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="mx-auto max-w-md rounded-card border border-hairline bg-surface p-6 shadow-2xl shadow-black/60">
                {/* One figure owns the screen. Distance is the metric a runner
                    glances down at mid-stride, so it gets the size and the rest
                    of the panel is deliberately quieter. */}
                <div className="text-center">
                  <span
                    data-testid="run-distance"
                    className="rg-metric text-[88px] text-ink"
                  >
                    {km.toFixed(2)}
                  </span>
                  <span className="rg-label ml-2">km</span>
                </div>

                {/* No boxes: at a glance the eye needs the numbers, and three
                    bordered tiles compete with the figure above them. */}
                <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4 text-center">
                  {[
                    // "Avg pace" and "Pace" rather than the Activity tab's
                    // "Pace /km" label with a bare figure: mid-run these two sit
                    // side by side, and telling the average from the current one
                    // matters more here than a tidy unit-free number column.
                    { label: "Time", value: formatDuration(elapsedS) },
                    { label: "Avg pace", value: `${formatPace(avgPaceS)} /km` },
                    { label: "Pace", value: `${formatPace(currentPaceS)} /km` },
                  ].map((stat) => (
                    <div key={stat.label} className="flex flex-col-reverse">
                      <dt className="rg-label mt-1.5">{stat.label}</dt>
                      <dd className="rg-metric text-xl text-ink">{stat.value}</dd>
                    </div>
                  ))}
                </dl>

                {/* 80px targets: this is pressed mid-run, one-thumbed, often in
                    the rain. Well above the 44px floor the rest of the app uses. */}
                <div className="mt-6 flex items-center justify-center gap-4">
                  {phase === "running" ? (
                    <button
                      type="button"
                      onClick={pauseRun}
                      aria-label="Pause run"
                      className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-canvas transition active:scale-95"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8">
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
                        className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-danger/50 bg-danger-wash text-danger transition hover:bg-danger/25 active:scale-95"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
                          <rect x="6" y="6" width="12" height="12" rx="1.5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={resumeRun}
                        aria-label="Resume run"
                        className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-canvas transition active:scale-95"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 h-8 w-8">
                          <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                {phase === "paused" && (
                  <p className="rg-label mt-3 text-center">
                    Paused — press stop to finish your run
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Summary */}
          {phase === "finished" && (
            <div className="pointer-events-auto absolute inset-0 flex items-end justify-center overflow-y-auto bg-canvas/70 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center">
              <section className="animate-float-in w-full max-w-md rounded-card border border-hairline bg-canvas/90 p-6 shadow-2xl shadow-black/60">
                <header className="text-center">
                  <p className="rg-label text-accent">Run complete</p>
                  <h2 className="rg-display mt-2 truncate text-2xl uppercase text-ink">
                    {route.name}
                  </h2>
                </header>

                {/* The animated, shareable run card is the hero of the finish
                    screen — it shows the ran route, distance, time, pace and
                    grade, and exports the animation as a video. */}
                <div className="mt-4">
                  <RunShareCard
                    data={{
                      name: route.name,
                      path: runPath,
                      distanceKm: km,
                      durationS: elapsedS,
                      avgPaceS,
                      grade: route.grade,
                      score: route.score,
                      intersectionsPerKm: route.intersections_per_km ?? null,
                      sidewalkCoverage: route.sidewalk_coverage ?? null,
                    }}
                  />
                </div>

                {splits.length > 0 && (
                  <div className="mt-4">
                    <h3 className="rg-label mb-1.5">Splits</h3>
                    <ul className="max-h-36 overflow-y-auto rounded-control border border-hairline bg-raised">
                      {splits.map((split) => (
                        <li
                          key={split.km}
                          className="flex items-center justify-between border-b border-hairline px-3 py-2 text-xs last:border-b-0"
                        >
                          <span className="text-muted">km {split.km}</span>
                          <span className="rg-metric text-sm text-ink">
                            {formatPace(split.duration_s)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {isAuthenticated && !saved && (
                  <div className="mt-4">
                    <RunRating value={rating} onChange={setRating} disabled={saving} />
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-2">
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || saved}
                      className={`rg-btn w-full ${
                        saved
                          ? "cursor-default border border-accent/40 bg-accent-wash text-accent"
                          : "rg-btn-primary disabled:cursor-wait"
                      }`}
                    >
                      {saved ? (
                        <>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          {hasRating(rating) ? "Saved with your rating" : "Saved to your account"}
                        </>
                      ) : saving ? (
                        "Saving…"
                      ) : hasRating(rating) ? (
                        "Save run & rating"
                      ) : (
                        "Save this run"
                      )}
                    </button>
                  ) : (
                    <Link href="/login?next=/" className="rg-btn rg-btn-secondary w-full">
                      Sign in to save &amp; rate this run
                    </Link>
                  )}
                  {saveError && (
                    <p role="alert" className="text-center text-xs text-danger">
                      {saveError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={onExit}
                    className="rg-btn rg-btn-secondary w-full"
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
