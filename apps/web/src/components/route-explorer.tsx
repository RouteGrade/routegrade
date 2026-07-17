"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import sampleRouteJson from "../fixtures/sample-route.json";
import { RouteGradeLogo } from "./brand/route-grade-logo";

const RouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-zinc-950">
      <span className="text-sm text-zinc-500">Loading map…</span>
    </div>
  ),
});

const sampleRoute = sampleRouteJson as FeatureCollection<LineString>;

type ApiStatus = "checking" | "online" | "offline";
type Preference = "quiet" | "flat" | "scenic";

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

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

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

export default function RouteExplorer({
  sessionNav,
}: { sessionNav?: React.ReactNode } = {}) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [address, setAddress] = useState("");
  const [distanceKm, setDistanceKm] = useState(5);
  const [preference, setPreference] = useState<Preference>("quiet");
  const [searching, setSearching] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [locating, setLocating] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const routeStats = useMemo(() => {
    const coords = sampleRoute.features[0].geometry.coordinates as [number, number][];
    let km = 0;
    for (let i = 1; i < coords.length; i++) {
      km += haversineKm(coords[i - 1], coords[i]);
    }
    const paceMinPerKm = 6;
    const minutes = Math.round(km * paceMinPerKm);
    const props = sampleRoute.features[0].properties ?? {};
    return {
      name: (props.name as string) ?? "Sample route",
      km: km.toFixed(1),
      minutes,
      elevation: (props.elevationGainM as number) ?? 0,
      grade: (props.grade as string) ?? "A-",
    };
  }, []);

  const handleUseMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setAddress("Location unavailable");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setAddress(`Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
        setLocating(false);
      },
      () => {
        setAddress("Location unavailable");
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const handleFindRoutes = (event: React.FormEvent) => {
    event.preventDefault();
    if (searching) return;
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      setSearching(false);
      setShowRoute(true);
    }, 900);
  };

  const sliderProgress = ((distanceKm - 1) / (15 - 1)) * 100;

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <RouteMap showRoute={showRoute} />

      {/* Top vignette for legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-linear-to-b from-zinc-950/80 to-transparent" />

      <div className="absolute inset-x-3 top-3 flex max-h-[calc(100dvh-1.5rem)] flex-col gap-3 overflow-y-auto sm:inset-x-auto sm:left-5 sm:top-5 sm:w-[380px]">
        {/* Control card */}
        <section className="rounded-2xl border border-white/10 bg-zinc-950/75 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <header className="mb-5 flex items-start justify-between gap-3">
            <RouteGradeLogo tagline />
            <div className="flex items-center gap-2">
              <StatusPill status={apiStatus} />
              {sessionNav}
            </div>
          </header>

          <form onSubmit={handleFindRoutes} className="flex flex-col gap-4">
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
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Nathan Phillips Square, Toronto"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 outline-none transition focus:border-emerald-400/60 focus:bg-white/10 focus:ring-2 focus:ring-emerald-400/20"
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
          </form>
        </section>

        {/* Route result card */}
        {showRoute && (
          <section className="animate-float-in rounded-2xl border border-white/10 bg-zinc-950/75 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display text-sm font-bold text-white">
                    {routeStats.name}
                  </h2>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                    Sample
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  Scoring arrives in Milestone 2 — this grade is a preview.
                </p>
              </div>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-emerald-400 to-lime-400 font-display text-lg font-extrabold text-zinc-950 shadow-lg shadow-emerald-500/30">
                {routeStats.grade}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center">
              {[
                { label: "Distance", value: `${routeStats.km} km` },
                { label: "Est. time", value: `${routeStats.minutes} min` },
                { label: "Elevation", value: `${routeStats.elevation} m` },
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
          </section>
        )}
      </div>
    </div>
  );
}
