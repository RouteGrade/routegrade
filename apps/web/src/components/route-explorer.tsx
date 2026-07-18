"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LineString } from "geojson";
import {
  ApiError,
} from "@/lib/api/authenticated-client";
import {
  getSavedRoute,
  planRoute,
  saveRoute,
  type PlanResponse,
  type PlannedRoute,
  type Preference,
} from "@/lib/api/routes-client";
import { RouteGradeLogo } from "./brand/route-grade-logo";

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
            intersections_per_km: 0,
            sidewalk_coverage: null,
            score: saved.score,
            grade: saved.grade,
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

  const active: ActiveRoute | null = plan
    ? {
        route: plan.routes[Math.min(activeIndex, plan.routes.length - 1)],
        startingAddress: address.trim() || plan.start.label,
        saved: false,
      }
    : reopened;

  const activeGeometry: LineString | null = active
    ? { type: "LineString", coordinates: active.route.geometry.coordinates }
    : null;

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

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <RouteMap geometry={activeGeometry} />

      {/* Vignettes for legibility — top on desktop, bottom behind the mobile sheet */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-36 bg-linear-to-b from-zinc-950/80 to-transparent sm:block" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-linear-to-t from-zinc-950/80 to-transparent sm:hidden" />

      {/* Bottom sheet on phones (results stacked above the controls),
          fixed left column on sm+ */}
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

            <div className="mt-3">
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || activeSaved}
                  className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                    activeSaved
                      ? "cursor-default border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : "bg-linear-to-r from-emerald-400 to-cyan-400 text-zinc-950 shadow-lg shadow-emerald-500/20 hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
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
    </div>
  );
}
