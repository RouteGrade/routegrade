"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { LineString } from "geojson";
import {
  ApiError,
} from "@/lib/api/authenticated-client";
import {
  geocodeAddress,
  getSavedRoute,
  gradeCustomRoute,
  planRoute,
  saveRoute,
  snapRoute,
  type PlanResponse,
  type PlannedRoute,
  type Preference,
} from "@/lib/api/routes-client";
import { useRouteDraw } from "@/lib/route-draw/use-route-draw";
import { useImmersive } from "./shell/app-shell";
import { PlannerHero } from "./run-tab/planner-hero";
import { RouteDetail } from "./route-detail/route-detail";
import { RouteScorecard } from "./route-scorecard";
import RunTracker, { primeSpeech } from "./run-tracker";
import type { RunTelemetry } from "./run-tracker";

const RouteMap = dynamic(() => import("./route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-canvas">
      <span className="text-sm text-faint">Loading map…</span>
    </div>
  ),
});

type ApiStatus = "checking" | "online" | "offline";

// Shelved 2026-07-23: the freehand "draw your own route" tool didn't work as
// intended. Its code (route-map draw mode, lib/route-draw, /nearest, /segment)
// is kept for the address-based multi-stop route builder that replaces it —
// this flag hides the old entry point without deleting anything.
const ROUTE_DRAW_ENABLED = false;

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

type ActiveRoute = {
  route: PlannedRoute;
  /** Address text to persist when saving. */
  startingAddress: string | null;
  saved: boolean;
};

export default function RouteExplorer({
  isAuthenticated = false,
  savedRouteId,
  startInBuilderMode = false,
}: {
  isAuthenticated?: boolean;
  savedRouteId?: string;
  /**
   * Open straight into the address-based route builder — the Routes tab links
   * here with `?build=1`. (The freehand draw tool it replaced is shelved; see
   * ROUTE_DRAW_ENABLED.)
   */
  startInBuilderMode?: boolean;
} = {}) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Coordinates of a tapped address suggestion. Lets the plan request name an
  // exact point instead of re-geocoding the text, which can otherwise resolve
  // to a different place than the one the runner picked.
  const [pickedPlace, setPickedPlace] = useState<
    { latitude: number; longitude: number } | null
  >(null);
  // Where to point the map camera — set to the runner's location on first load.
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
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
  // Shelved freehand draw mode (behind ROUTE_DRAW_ENABLED). The structured
  // route state (waypoints + segments, undo/redo, draggable markers) is reused
  // by the address-based multi-stop builder below.
  const [drawing, setDrawing] = useState(false);
  const draw = useRouteDraw();
  const [customName, setCustomName] = useState("");
  const [grading, setGrading] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);

  // "Create your own route": enter start/end (+ stops), we route through them
  // (optionally as a loop), then the user adjusts + grades + saves.
  const [builderOpen, setBuilderOpen] = useState(startInBuilderMode);
  const [startAddr, setStartAddr] = useState("");
  const [endAddr, setEndAddr] = useState("");
  const [stops, setStops] = useState<string[]>([]);
  const [loopMode, setLoopMode] = useState(false);
  const [building, setBuilding] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  // Live run mode: the planner UI hides and RunTracker takes over the screen.
  const [runMode, setRunMode] = useState(false);
  const [runTelemetry, setRunTelemetry] = useState<RunTelemetry | null>(null);
  // Shareable scorecard overlay — private until the user explicitly opens it.
  const [scorecardOpen, setScorecardOpen] = useState(false);

  // A live run owns the whole screen: drop the tab bar so nothing competes with
  // the metrics, and so a stray tap can't navigate away mid-run and lose GPS.
  useImmersive(runMode);

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

  // The drawn (not yet graded) route's snapped geometry, shown on the map until
  // it becomes a graded route (which then flows through `active`/`plan`).
  const drawnGeometry: LineString | null = useMemo(
    () =>
      draw.coordinates.length >= 2
        ? { type: "LineString", coordinates: draw.coordinates }
        : null,
    [draw.coordinates],
  );
  const mapGeometry = plan ? activeGeometry : (drawnGeometry ?? activeGeometry);

  // NOTE: the shelved freehand draw tool (ROUTE_DRAW_ENABLED) no longer has an
  // entry point. Its old "Draw your own route" button lived in the planner form
  // this tab replaced, so re-enabling the flag now also means adding a way in —
  // everything downstream of that (the draw overlay, lib/route-draw, /nearest,
  // /segment) is still here and still wired up.

  /** Drop the current result and return to the idle Run tab. */
  const clearActiveRoute = () => {
    setPlan(null);
    setReopened(null);
    setPlanError(null);
    setSaveError(null);
    draw.clear();
  };

  const cancelDrawing = () => {
    setDrawing(false);
    setBuilderOpen(false);
    draw.clear();
    setDrawError(null);
  };

  const openBuilder = () => {
    setPlan(null);
    setReopened(null);
    setPlanError(null);
    draw.clear();
    setDrawError(null);
    setBuilderError(null);
    setCustomName("");
    setBuilderOpen(true);
  };

  const addStop = () => setStops((s) => [...s, ""]);
  const removeStop = (i: number) =>
    setStops((s) => s.filter((_, idx) => idx !== i));
  const setStop = (i: number, value: string) =>
    setStops((s) => s.map((v, idx) => (idx === i ? value : v)));

  const buildAddressRoute = async () => {
    const addresses = [startAddr, ...stops, endAddr]
      .map((a) => a.trim())
      .filter(Boolean);
    if (addresses.length < 2) {
      setBuilderError("Enter at least a start and an end.");
      return;
    }
    setBuilding(true);
    setBuilderError(null);
    try {
      const results = await Promise.all(addresses.map((a) => geocodeAddress(a)));
      const points = results.map(
        (r) => [r.longitude, r.latitude] as [number, number],
      );
      setMapCenter(points[0]);
      await draw.buildFromWaypoints(points, loopMode);
    } catch (err) {
      setBuilderError(
        err instanceof ApiError
          ? err.message
          : "Couldn't build a route through those points.",
      );
    } finally {
      setBuilding(false);
    }
  };

  const gradeDrawnRoute = async () => {
    if (draw.coordinates.length < 2) return;
    setGrading(true);
    setDrawError(null);
    try {
      const route = await gradeCustomRoute({
        coordinates: draw.coordinates,
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
      draw.clear();
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

  const locateUser = (opts?: { silent?: boolean }) => {
    if (!("geolocation" in navigator)) {
      if (!opts?.silent) setPlanError("Location is unavailable in this browser.");
      return;
    }
    if (!opts?.silent) setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ latitude, longitude });
        setAddress(`Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
        setMapCenter([longitude, latitude]);
        setLocating(false);
      },
      () => {
        if (!opts?.silent) {
          setPlanError("We couldn't read your location. Type an address instead.");
        }
        setLocating(false);
      },
      { timeout: 8000 },
    );
  };

  const handleUseMyLocation = () => locateUser();

  // First landing (after the login/entry gate): snap the map to the runner's
  // current location. Skips a deep-linked saved route and a restored guest plan
  // so it never overrides an already-chosen start.
  useEffect(() => {
    if (savedRouteId) return;
    try {
      if (sessionStorage.getItem(GUEST_PLAN_STASH_KEY)) return;
    } catch {
      // sessionStorage unavailable — fine, just locate.
    }
    // Deferred so the effect body stays setState-free (locateUser sets state).
    const timer = setTimeout(() => locateUser({ silent: true }), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          : pickedPlace
            ? {
                latitude: pickedPlace.latitude,
                longitude: pickedPlace.longitude,
                address: trimmed,
              }
            : { address: trimmed }),
        distance_km: distanceKm,
        preference,
      });
      setPlan(response);
      setActiveIndex(0);
      setReopened(null);
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

  const activeSaved = active ? active.saved || savedIds.has(active.route.id) : false;

  const handleStartRun = () => {
    primeSpeech(); // unlock speech synthesis while we still have a user gesture
    setRunMode(true);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <RouteMap
        geometry={mapGeometry}
        runner={runTelemetry}
        follow={runMode}
        center={mapCenter}
        flat={drawing || draw.hasRoute || draw.isRouting}
        drawing={drawing}
        waypoints={!drawing && !plan && draw.hasRoute ? draw.waypoints : []}
        onWaypointMove={(id, lngLat) => draw.moveWaypoint(id, lngLat)}
        onSnap={async (coords) => {
          try {
            const { geometry } = await snapRoute(coords);
            return geometry.coordinates;
          } catch {
            return null;
          }
        }}
        onDrawComplete={(coords) => {
          setDrawing(false);
          // Turn the raw drag into a structured, road-snapped route.
          void draw.buildFromDrag(coords);
        }}
      />

      {/* Address builder: start / stops / end + loop, routed through the points. */}
      {builderOpen && !draw.hasRoute && !draw.isRouting && !plan && !runMode && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2.5 rounded-card border border-hairline bg-surface p-4 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Create your own route</p>
              <button
                type="button"
                onClick={cancelDrawing}
                className="rounded-lg border border-hairline bg-raised px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-raised"
              >
                Cancel
              </button>
            </div>
            <input
              type="text"
              value={startAddr}
              onChange={(e) => setStartAddr(e.target.value)}
              placeholder="Start address"
              className="h-10 w-full rounded-control border border-hairline bg-raised px-3 text-sm text-ink placeholder:text-faint focus:border-volt focus:outline-none"
            />
            {stops.map((stop, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={stop}
                  onChange={(e) => setStop(i, e.target.value)}
                  placeholder={`Stop ${i + 1}`}
                  className="h-10 w-full rounded-control border border-hairline bg-raised px-3 text-sm text-ink placeholder:text-faint focus:border-volt focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  aria-label={`Remove stop ${i + 1}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-hairline bg-raised text-muted transition hover:bg-raised hover:text-danger"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <input
              type="text"
              value={endAddr}
              onChange={(e) => setEndAddr(e.target.value)}
              placeholder="End address"
              className="h-10 w-full rounded-control border border-hairline bg-raised px-3 text-sm text-ink placeholder:text-faint focus:border-volt focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={addStop}
                className="flex items-center gap-1.5 text-xs font-semibold text-volt transition hover:text-volt"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3.5 w-3.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add stop
              </button>
              <button
                type="button"
                onClick={() => setLoopMode((v) => !v)}
                aria-pressed={loopMode}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  loopMode
                    ? "border-volt bg-volt-wash text-volt"
                    : "border-hairline bg-raised text-ink hover:bg-raised"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M17 2l4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="M7 22l-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </svg>
                Loop
              </button>
            </div>
            <button
              type="button"
              onClick={buildAddressRoute}
              disabled={building}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-volt text-sm font-bold text-canvas transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {building ? "Building…" : "Build route"}
            </button>
            {loopMode && (
              <p className="text-center text-[11px] text-faint">
                Loop returns to your start, avoiding retracing where it can.
              </p>
            )}
            {builderError && (
              <p role="alert" className="text-center text-xs text-danger">
                {builderError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Route-ready overlay: routing → name/edit/grade. Shared by the shelved
          draw tool and the address builder (both produce the structured route). */}
      {!runMode && !plan && ((ROUTE_DRAW_ENABLED && drawing) || draw.isRouting || draw.hasRoute) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className="pointer-events-auto w-full max-w-md rounded-card border border-hairline bg-surface p-4 shadow-2xl shadow-black/60">
            {drawing ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink">
                  <span className="mr-1.5 text-volt">✎</span>
                  Drag to draw — your route snaps to the roads as you go.
                </p>
                <button
                  type="button"
                  onClick={cancelDrawing}
                  className="shrink-0 rounded-full border border-hairline-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-raised"
                >
                  Cancel
                </button>
              </div>
            ) : draw.isRouting ? (
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4 animate-spin text-volt">
                    <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                  </svg>
                  Building your route…
                </p>
                <button
                  type="button"
                  onClick={cancelDrawing}
                  className="shrink-0 rounded-full border border-hairline-strong px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-raised"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">Name your route</p>
                  <span className="text-xs font-medium tabular-nums text-volt">
                    {(draw.distanceMeters / 1000).toFixed(2)} km
                  </span>
                </div>
                <p className="-mt-1 text-[11px] text-faint">
                  Drag the dots on the map to fine-tune the route.
                </p>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="My route"
                  maxLength={120}
                  className="h-10 w-full rounded-control border border-hairline bg-raised px-3 text-sm text-ink placeholder:text-faint focus:border-volt focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={draw.undo}
                    disabled={!draw.canUndo || grading}
                    className="h-11 flex-1 rounded-control border border-hairline-strong text-sm font-semibold text-ink transition hover:bg-raised disabled:opacity-40"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={draw.redo}
                    disabled={!draw.canRedo || grading}
                    className="h-11 flex-1 rounded-control border border-hairline-strong text-sm font-semibold text-ink transition hover:bg-raised disabled:opacity-40"
                  >
                    Redo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      draw.clear();
                      setDrawError(null);
                      if (ROUTE_DRAW_ENABLED && drawing) setDrawing(true);
                      else setBuilderOpen(true);
                    }}
                    disabled={grading}
                    className="h-11 flex-1 rounded-control border border-hairline-strong text-sm font-semibold text-ink transition hover:bg-raised disabled:opacity-60"
                  >
                    Edit
                  </button>
                </div>
                <button
                  type="button"
                  onClick={gradeDrawnRoute}
                  disabled={grading}
                  className="rg-btn rg-btn-primary w-full disabled:cursor-wait"
                >
                  {grading ? "Grading…" : "Grade this route"}
                </button>
                <button
                  type="button"
                  onClick={cancelDrawing}
                  className="text-center text-xs font-medium text-faint transition hover:text-ink"
                >
                  Cancel
                </button>
                {(drawError || draw.error) && (
                  <p role="alert" className="text-center text-xs text-danger">
                    {drawError ??
                      "We couldn't route part of that. Try redrawing along connected paths."}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Idle Run tab: search pill, run goal, and one primary action over a
          full-bleed map. Hidden as soon as there is something to show. */}
      {!runMode && !active && !builderOpen && !draw.hasRoute && !draw.isRouting && (
        <PlannerHero
          address={address}
          onAddressChange={(value) => {
            setAddress(value);
            setCoords(null);
            setPickedPlace(null);
          }}
          onAddressPick={(place) => {
            setAddress(place.label);
            setPickedPlace({
              latitude: place.latitude,
              longitude: place.longitude,
            });
            // Move the camera to the picked place so the map confirms the
            // choice before the runner commits to planning from it.
            setMapCenter([place.longitude, place.latitude]);
          }}
          near={
            mapCenter
              ? { latitude: mapCenter[1], longitude: mapCenter[0] }
              : null
          }
          onLocate={handleUseMyLocation}
          locating={locating}
          distanceKm={distanceKm}
          onDistanceChange={setDistanceKm}
          preference={preference}
          onPreferenceChange={setPreference}
          searching={searching}
          onFind={handleFindRoutes}
          onOpenBuilder={openBuilder}
          planError={planError}
          apiOffline={apiStatus === "offline"}
        />
      )}

      {/* The hero (and with it the search field) yields the screen to a result,
          so a result needs its own way back — otherwise the only route out of a
          plan is switching tabs. */}
      {!runMode && active && (
        <button
          type="button"
          onClick={clearActiveRoute}
          aria-label="Back to search"
          className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top))] z-30 flex h-11 w-11 items-center justify-center rounded-full border border-hairline bg-surface text-ink transition-colors hover:bg-raised"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}

      {!runMode && active && (
        <RouteDetail
          route={active.route}
          candidates={plan && plan.routes.length > 1 ? plan.routes : null}
          activeIndex={activeIndex}
          onSelectCandidate={setActiveIndex}
          saved={activeSaved}
          isAuthenticated={isAuthenticated}
          saving={saving}
          saveError={saveError}
          onSave={handleSave}
          onStashPlan={() => {
            if (!plan) return;
            stashGuestPlan({
              address,
              coords,
              distanceKm,
              preference,
              plan,
              activeIndex,
            });
          }}
          onStartRun={handleStartRun}
          onShare={() => setScorecardOpen(true)}
        />
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
