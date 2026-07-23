"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LineString } from "geojson";
import {
  ApiError,
} from "@/lib/api/authenticated-client";
import {
  getSavedRoute,
  gradeCustomRoute,
  planRoute,
  saveRoute,
  type PlanResponse,
  type PlannedRoute,
  type Preference,
} from "@/lib/api/routes-client";
import { deriveReasons } from "@/lib/scorecard";
import { RouteGradeLogo } from "./brand/route-grade-logo";
import { RouteScorecard } from "./route-scorecard";
import RunTracker, { primeSpeech } from "./run-tracker";
import type { RunTelemetry } from "./run-tracker";

const RouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-zinc-950">
      <span className="text-sm text-zinc-500">Loading map…</span>
    </div>
  ),
});

type ApiStatus = "checking" | "online" | "offline";

const PACE_MIN_PER_KM = 6;

// A guest who taps "Sign in to save" bounces through /login?next=/ and would
// otherwise land back on a blank planner — the plan lives in React state, not
// the URL. Stash it in sessionStorage on the way out and rehydrate on return,
// so the route they wanted to save is one tap away.
const GUEST_PLAN_STASH_KEY = "rg_guest_plan";

type GuestPlanStash = {
  address: string;
  coords: { latitude: number; longitude: number } | null;
  distanceKm: number;
  preference: Preference;
  plan: PlanResponse;
  activeIndex: number;
};

function stashGuestPlan(stash: GuestPlanStash) {
  try {
    sessionStorage.setItem(GUEST_PLAN_STASH_KEY, JSON.stringify(stash));
  } catch {
    // sessionStorage can be unavailable (private mode / disabled) — best-effort.
  }
}

/** Read and clear the stash (one-shot). Returns null if absent or unparseable. */
function takeGuestPlan(): GuestPlanStash | null {
  try {
    const raw = sessionStorage.getItem(GUEST_PLAN_STASH_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(GUEST_PLAN_STASH_KEY);
    return JSON.parse(raw) as GuestPlanStash;
  } catch {
    return null;
  }
}

const PREFERENCES: { id: Preference; label: string; icon: React.ReactNode }[] = [
  {
    id: "quiet",
    label: "Quiet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M11 5 6 9H2v6h4l5 4z" />
        <line x1="22" x2="16" y1="9" y2="15" />
        <line x1="16" x2="22" y1="9" y2="15" />
      </svg>
    ),
  },
  {
    id: "flat",
    label: "Flat",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="M2 12h20" />
        <path d="M2 17h20" />
        <path d="M2 7h20" />
      </svg>
    ),
  },
  {
    id: "scenic",
    label: "Scenic",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
        <circle cx="19" cy="5" r="1" />
      </svg>
    ),
  },
];

function StatusPill({ status }: { status: ApiStatus }) {
  const config = {
    checking: { dot: "bg-amber-400", ring: "bg-amber-400/40", label: "Checking API…" },
    online: { dot: "bg-emerald-400", ring: "bg-emerald-400/40", label: "API connected" },
    offline: { dot: "bg-rose-500", ring: "bg-rose-500/40", label: "API offline" },
  }[status];

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
      <span className="relative flex h-2 w-2">
        {status !== "offline" && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.ring}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${config.dot}`} />
      </span>
      {config.label}
    </span>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-emerald-400 to-lime-400 font-display text-lg font-extrabold text-zinc-950 shadow-lg shadow-emerald-500/30">
      {grade}
    </span>
  );
}

type ActiveRoute = {
  route: PlannedRoute;
  /** Address text to persist when saving. */
  startingAddress: string | null;
  saved: boolean;
};

export default function RouteExplorer({
  sessionNav,
  isAuthenticated = false,
  savedRouteId,
}: {
  sessionNav?: React.ReactNode;
  isAuthenticated?: boolean;
  savedRouteId?: string;
} = {}) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [distanceKm, setDistanceKm] = useState(5);
  const [preference, setPreference] = useState<Preference>("quiet");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [planError, setPlanError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reopened, setReopened] = useState<ActiveRoute | null>(null);
  // Mobile-only: the planner form collapses into a bottom-sheet header so the
  // map stays visible. Ignored on sm+ where the form is always shown.
  const [formOpen, setFormOpen] = useState(true);
  // "Create your own route": freehand draw on the map, then grade the drawn
  // path through /custom and hand the result to the normal result card.
  const [drawing, setDrawing] = useState(false);
  const [drawnCoords, setDrawnCoords] = useState<[number, number][] | null>(null);
  const [customName, setCustomName] = useState("");
  const [grading, setGrading] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  // Live run mode: the planner UI hides and RunTracker takes over the screen.
  const [runMode, setRunMode] = useState(false);
  const [runTelemetry, setRunTelemetry] = useState<RunTelemetry | null>(null);
  // Shareable scorecard overlay — private until the user explicitly opens it.
  const [scorecardOpen, setScorecardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const body = res.ok ? await res.json() : null;
        if (!cancelled) {
          setApiStatus(body?.status === "ok" ? "online" : "offline");
        }
      } catch {
        if (!cancelled) setApiStatus("offline");
      }
    };
    check();
    const interval = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Reopen a saved route linked from /account (?route=<id>).
  useEffect(() => {
    if (!savedRouteId || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await getSavedRoute(savedRouteId);
        if (cancelled) return;
        setReopened({
          route: {
            id: saved.id,
            name: saved.name,
            geometry: saved.geometry,
            distance_km: saved.distance_km,
            elevation_gain_m: saved.elevation_gain_m,
            // Real persisted value, or null for legacy routes saved before the
            // metric was stored (scorecard omits the crossings reason then).
            intersections_per_km: saved.intersections_per_km,
            sidewalk_coverage: null,
            score: saved.score,
            grade: saved.grade,
            elevation_subscore: null,
            intersection_subscore: null,
            within_tolerance: true,
            provider: "saved",
          },
          startingAddress: saved.starting_address,
          saved: true,
        });
        if (saved.starting_address) setAddress(saved.starting_address);
        setDistanceKm(Math.min(15, Math.max(1, Math.round(saved.distance_km * 2) / 2)));
        setPreference(saved.preference);
        setSavedIds((prev) => new Set(prev).add(saved.id));
        if (window.matchMedia("(max-width: 639px)").matches) {
          setFormOpen(false);
        }
      } catch {
        // Deleted or someone else's link — quietly fall back to a fresh planner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [savedRouteId, isAuthenticated]);

  // Restore a guest's in-progress plan after they bounce through /login to save
  // it. One-shot: consumed and cleared on the first planner mount that finds a
  // stash. A deep-linked saved route (?route=) takes precedence and skips this.
  useEffect(() => {
    if (savedRouteId) return;
    // Consume the stash synchronously so a StrictMode double-mount can't apply
    // it twice; defer the state writes so the effect body stays setState-free.
    const stash = takeGuestPlan();
    if (!stash) return;
    const timer = setTimeout(() => {
      setAddress(stash.address);
      setCoords(stash.coords);
      setDistanceKm(stash.distanceKm);
      setPreference(stash.preference);
      setPlan(stash.plan);
      setActiveIndex(stash.activeIndex);
      if (window.matchMedia("(max-width: 639px)").matches) setFormOpen(false);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active: ActiveRoute | null = plan
    ? {
        route: plan.routes[Math.min(activeIndex, plan.routes.length - 1)],
        startingAddress: address.trim() || plan.start.label,
        saved: false,
      }
    : reopened;

  // Stable identity across re-renders (e.g. telemetry ticks during a run) —
  // RouteMap treats a new `geometry` reference as "the route changed" and
  // re-plays its intro draw animation, so a fresh object here on every
  // render made the route line appear to animate continuously mid-run.
  const activeCoordinates = active?.route.geometry.coordinates ?? null;
  const activeGeometry: LineString | null = useMemo(
    () => (activeCoordinates ? { type: "LineString", coordinates: activeCoordinates } : null),
    [activeCoordinates],
  );

  // The just-drawn (not yet graded) freehand path, shown on the map until it
  // becomes a graded route (which then flows through `active`/`plan`).
  const drawnGeometry: LineString | null = useMemo(
    () =>
      drawnCoords && drawnCoords.length >= 2
        ? { type: "LineString", coordinates: drawnCoords }
        : null,
    [drawnCoords],
  );
  const mapGeometry = plan ? activeGeometry : (drawnGeometry ?? activeGeometry);

  const startDrawing = () => {
    setPlan(null);
    setReopened(null);
    setPlanError(null);
    setDrawnCoords(null);
    setDrawError(null);
    setCustomName("");
    setDrawing(true);
    if (window.matchMedia("(max-width: 639px)").matches) setFormOpen(false);
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setDrawnCoords(null);
    setDrawError(null);
  };

  const gradeDrawnRoute = async () => {
    if (!drawnCoords || drawnCoords.length < 2) return;
    setGrading(true);
    setDrawError(null);
    try {
      const route = await gradeCustomRoute({
        coordinates: drawnCoords,
        preference,
        name: customName.trim() || undefined,
      });
      const [lng, lat] = route.geometry.coordinates[0];
      setPlan({
        start: { latitude: lat, longitude: lng, label: route.name },
        requested_distance_km: route.distance_km,
        preference,
        distance_tolerance: 0,
        routes: [route],
      });
      setActiveIndex(0);
      setDrawnCoords(null);
      setDrawing(false);
    } catch (err) {
      setDrawError(
        err instanceof ApiError
          ? err.message
          : "Couldn't grade that route. Please try again.",
      );
    } finally {
      setGrading(false);
    }
  };

  const handleUseMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setPlanError("Location is unavailable in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ latitude, longitude });
        setAddress(`Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
        setLocating(false);
      },
      () => {
        setPlanError("We couldn't read your location. Type an address instead.");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const handleFindRoutes = async (event: React.FormEvent) => {
    event.preventDefault();
    if (searching) return;

    const trimmed = address.trim();
    const usingCoords = coords !== null && trimmed.startsWith("Current location (");
    if (!trimmed && !usingCoords) {
      setPlanError("Enter a starting address or use your location.");
      return;
    }

    setSearching(true);
    setPlanError(null);
    setSaveError(null);
    try {
      const response = await planRoute({
        ...(usingCoords
          ? { latitude: coords.latitude, longitude: coords.longitude, address: trimmed }
          : { address: trimmed }),
        distance_km: distanceKm,
        preference,
      });
      setPlan(response);
      setActiveIndex(0);
      setReopened(null);
      // On phones, tuck the form away so the map and result take the stage.
      if (window.matchMedia("(max-width: 639px)").matches) {
        setFormOpen(false);
      }
    } catch (err) {
      setPlan(null);
      if (err instanceof ApiError && err.status === 404) {
        setPlanError("We couldn't find that address. Try being more specific.");
      } else if (err instanceof ApiError && err.status === 429) {
        setPlanError("You're planning routes quickly — give it a few seconds and try again.");
      } else if (err instanceof ApiError && err.status === 502) {
        setPlanError("Route providers are unavailable right now. Please try again shortly.");
      } else {
        setPlanError("Something went wrong while planning. Please try again.");
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSave = async () => {
    if (!active || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveRoute(active.route.id, {
        name: active.route.name,
        starting_address: active.startingAddress,
        distance_km: active.route.distance_km,
        preference,
        geometry: active.route.geometry,
        elevation_gain_m: active.route.elevation_gain_m,
        intersections_per_km: active.route.intersections_per_km,
        score: active.route.score,
        grade: active.route.grade,
      });
      setSavedIds((prev) => new Set(prev).add(active.route.id));
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.status === 401
          ? "Your session expired — sign in again to save."
          : "Couldn't save this route. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const sliderProgress = ((distanceKm - 1) / (15 - 1)) * 100;
  const activeSaved = active ? active.saved || savedIds.has(active.route.id) : false;
  const estMinutes = active ? Math.round(active.route.distance_km * PACE_MIN_PER_KM) : 0;
  const gradeReasons = active ? deriveReasons(active.route) : [];
  const subscoreFactors = active
    ? [
        { label: "Elevation", value: active.route.elevation_subscore },
        { label: "Quietness", value: active.route.intersection_subscore },
      ].filter((f): f is { label: string; value: number } => f.value !== null)
    : [];

  const handleStartRun = () => {
    primeSpeech(); // unlock speech synthesis while we still have a user gesture
    setRunMode(true);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <RouteMap
        geometry={mapGeometry}
        runner={runTelemetry}
        follow={runMode}
        drawing={drawing}
        onDrawComplete={(coords) => {
          setDrawnCoords(coords);
          setDrawing(false);
        }}
      />

      {/* Draw-mode overlay: instructions while drawing, then name + grade. */}
      {!runMode && (drawing || drawnCoords) && !plan && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/85 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl">
            {drawing ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-zinc-200">
                  <span className="mr-1.5 text-pink-400">✎</span>
                  Press and drag on the map to draw your route.
                </p>
                <button
                  type="button"
                  onClick={cancelDrawing}
                  className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-white">Name your route</p>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="My route"
                  maxLength={120}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-400/50 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawnCoords(null);
                      setDrawError(null);
                      setDrawing(true);
                    }}
                    disabled={grading}
                    className="h-10 flex-1 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-60"
                  >
                    Redraw
                  </button>
                  <button
                    type="button"
                    onClick={gradeDrawnRoute}
                    disabled={grading}
                    className="h-10 flex-[1.5] rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                  >
                    {grading ? "Grading…" : "Grade this route"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={cancelDrawing}
                  className="text-center text-xs font-medium text-zinc-500 transition hover:text-zinc-300"
                >
                  Cancel
                </button>
                {drawError && (
                  <p role="alert" className="text-center text-xs text-rose-400">
                    {drawError}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vignettes for legibility — top on desktop, bottom behind the mobile sheet */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-36 bg-linear-to-b from-zinc-950/80 to-transparent sm:block" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-linear-to-t from-zinc-950/80 to-transparent sm:hidden" />

      {/* Bottom sheet on phones (results stacked above the controls),
          fixed left column on sm+. Hidden entirely while a run is live. */}
      {!runMode && (
      <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col-reverse gap-2 overflow-y-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:left-5 sm:top-5 sm:max-h-[calc(100dvh-2.5rem)] sm:w-[380px] sm:flex-col sm:gap-3 sm:p-0">
        {/* Control card */}
        <section className="rounded-2xl border border-white/10 bg-zinc-950/75 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-5">
          <header
            className={`flex items-center justify-between gap-3 ${formOpen ? "mb-5" : "mb-0"} sm:mb-5 sm:items-start`}
          >
            <RouteGradeLogo tagline />
            <div className="flex items-center gap-2">
              <StatusPill status={apiStatus} />
              {sessionNav}
              <button
                type="button"
                onClick={() => setFormOpen((open) => !open)}
                aria-expanded={formOpen}
                aria-controls="planner-form"
                aria-label={formOpen ? "Hide route options" : "Show route options"}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 sm:hidden"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-4 w-4 transition-transform duration-300 ${formOpen ? "rotate-180" : ""}`}
                >
                  <path d="m6 15 6-6 6 6" />
                </svg>
              </button>
            </div>
          </header>

          <form
            id="planner-form"
            onSubmit={handleFindRoutes}
            className={`flex-col gap-4 ${formOpen ? "flex" : "hidden"} sm:flex`}
          >
            <div>
              <label
                htmlFor="start-address"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
              >
                Starting point
              </label>
              <div className="relative">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <input
                  id="start-address"
                  type="text"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setCoords(null);
                  }}
                  placeholder="Nathan Phillips Square, Toronto"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-base text-white placeholder:text-zinc-500 outline-none transition focus:border-emerald-400/60 focus:bg-white/10 focus:ring-2 focus:ring-emerald-400/20 sm:text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={locating}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 transition hover:text-emerald-300 disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 ${locating ? "animate-spin" : ""}`}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
                {locating ? "Locating…" : "Use my location"}
              </button>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="distance"
                  className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
                >
                  Distance
                </label>
                <span className="rounded-md bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-300">
                  {distanceKm.toFixed(1)} km
                </span>
              </div>
              <input
                id="distance"
                type="range"
                min={1}
                max={15}
                step={0.5}
                value={distanceKm}
                onChange={(e) => setDistanceKm(Number(e.target.value))}
                className="rg-slider"
                style={{ "--slider-progress": `${sliderProgress}%` } as React.CSSProperties}
              />
              <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                <span>1 km</span>
                <span>15 km</span>
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Vibe
              </span>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Route preference">
                {PREFERENCES.map((option) => {
                  const selected = preference === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPreference(option.id)}
                      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition ${
                        selected
                          ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300 shadow-inner shadow-emerald-400/10"
                          : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:bg-white/10 hover:text-zinc-200"
                      }`}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={searching}
              className="group relative mt-1 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-400/40 hover:brightness-110 active:scale-[0.98] disabled:cursor-wait disabled:opacity-80"
            >
              {searching ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4 animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                  </svg>
                  Grading routes…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-hover:scale-110">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  Find routes
                </>
              )}
            </button>

            {planError && (
              <p role="alert" className="text-xs text-rose-400">
                {planError}
              </p>
            )}

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                or
              </span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <button
              type="button"
              onClick={startDrawing}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <circle cx="11" cy="11" r="2" />
              </svg>
              Draw your own route
            </button>
          </form>
        </section>

        {/* Route result card */}
        {active && (
          <section className="animate-float-in rounded-2xl border border-white/10 bg-zinc-950/75 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl">
            {plan && plan.routes.length > 1 && (
              <div className="mb-3 flex gap-1.5" role="tablist" aria-label="Route candidates">
                {plan.routes.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    type="button"
                    role="tab"
                    aria-selected={index === activeIndex}
                    onClick={() => setActiveIndex(index)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                      index === activeIndex
                        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                        : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {candidate.grade} · {candidate.distance_km.toFixed(1)} km
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display text-sm font-bold text-white">
                    {active.route.name}
                  </h2>
                  {active.route.provider === "saved" ? (
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                      Saved
                    </span>
                  ) : !active.route.within_tolerance ? (
                    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                      Off target
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Graded from elevation, intersections &amp; sidewalk data.
                </p>
              </div>
              <GradeBadge grade={active.route.grade} />
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center">
              {[
                { label: "Distance", value: `${active.route.distance_km.toFixed(1)} km` },
                { label: "Est. time", value: `${estMinutes} min` },
                { label: "Elevation", value: `${Math.round(active.route.elevation_gain_m)} m` },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-white/10 bg-white/5 py-2">
                  <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
                    {stat.label}
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums text-white">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>

            {(subscoreFactors.length > 0 || gradeReasons.length > 0) && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Why this grade
                </p>
                {subscoreFactors.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {subscoreFactors.map((factor) => (
                      <div key={factor.label} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11px] text-zinc-400">
                          {factor.label}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-linear-to-r from-emerald-400 to-cyan-400"
                            style={{ width: `${Math.round(factor.value)}%` }}
                          />
                        </div>
                        <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-zinc-300">
                          {Math.round(factor.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {gradeReasons.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {gradeReasons.map((reason, i) => (
                      <li
                        key={`${reason.key}-${i}`}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-300"
                      >
                        {reason.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleStartRun}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:shadow-emerald-400/40 hover:brightness-110 active:scale-[0.98]"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z" />
                </svg>
                Start run
              </button>
              <button
                type="button"
                onClick={() => setScorecardOpen(true)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <path d="M16 6l-4-4-4 4M12 2v13" />
                </svg>
                Share scorecard
              </button>
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || activeSaved}
                  className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${
                    activeSaved
                      ? "cursor-default border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
                  }`}
                >
                  {activeSaved ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      Saved to your account
                    </>
                  ) : saving ? (
                    "Saving…"
                  ) : (
                    "Save this route"
                  )}
                </button>
              ) : (
                <Link
                  href="/login?next=/"
                  onClick={() => {
                    if (plan) {
                      stashGuestPlan({
                        address,
                        coords,
                        distanceKm,
                        preference,
                        plan,
                        activeIndex,
                      });
                    }
                  }}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10"
                >
                  Sign in to save this route
                </Link>
              )}
              {saveError && (
                <p role="alert" className="mt-2 text-xs text-rose-400">
                  {saveError}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
      )}

      {runMode && active && (
        <RunTracker
          route={{
            id: active.route.id,
            name: active.route.name,
            geometry: active.route.geometry,
            distance_km: active.route.distance_km,
            grade: active.route.grade,
            score: active.route.score,
            elevation_gain_m: active.route.elevation_gain_m,
            intersections_per_km: active.route.intersections_per_km,
            sidewalk_coverage: active.route.sidewalk_coverage,
            preference,
          }}
          isAuthenticated={isAuthenticated}
          onExit={() => {
            setRunMode(false);
            setRunTelemetry(null);
          }}
          onTelemetry={setRunTelemetry}
        />
      )}

      {scorecardOpen && active && (
        <RouteScorecard
          route={{
            name: active.route.name,
            grade: active.route.grade,
            score: active.route.score,
            distance_km: active.route.distance_km,
            elevation_gain_m: active.route.elevation_gain_m,
            intersections_per_km: active.route.intersections_per_km,
            sidewalk_coverage: active.route.sidewalk_coverage,
          }}
          onClose={() => setScorecardOpen(false)}
        />
      )}
    </div>
  );
}
