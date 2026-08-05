"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LineString } from "geojson";
import { SplitsChart } from "@/components/activity/splits-chart";
import { ApiError } from "@/lib/api/authenticated-client";
import { getRun, type RecordedRun } from "@/lib/api/runs-client";
import { formatDuration } from "@/lib/geo";
import { effortMetric } from "@/lib/effort-metric";

const RouteMap = dynamic(() => import("@/components/route-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-canvas" />,
});

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; run: RecordedRun }
  | { kind: "error"; message: string };

/**
 * A single recorded run: the path you took on a map, the headline numbers, and
 * the per-kilometre splits.
 *
 * Everything here comes from the run record the API already returns — no
 * aggregate or detail-specific endpoint was needed.
 */
export function RunDetailView({ runId }: { runId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const run = await getRun(runId);
        if (!cancelled) setState({ kind: "ready", run });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err instanceof ApiError && err.status === 404
              ? "That run no longer exists."
              : "We couldn't load this run.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Read before the early return so the hooks below run unconditionally.
  const loaded = state.kind === "ready" ? state.run : null;

  // Stable identity so RouteMap doesn't treat every render as a new route and
  // replay its draw animation.
  const coordinates = loaded?.path?.coordinates ?? null;
  const geometry: LineString | null = useMemo(
    () => (coordinates ? { type: "LineString", coordinates } : null),
    [coordinates],
  );

  if (state.kind !== "ready") {
    return (
      <div className="h-full overflow-y-auto px-5 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <BackLink />
        <p
          className={`mt-6 text-sm ${state.kind === "error" ? "text-danger" : "text-muted"}`}
          role={state.kind === "error" ? "alert" : undefined}
        >
          {state.kind === "error" ? state.message : "Loading this run…"}
        </p>
      </div>
    );
  }

  const { run } = state;
  const rate = effortMetric(run.activity, run.avg_pace_s_per_km);
  const stats = [
    { label: "Time", value: formatDuration(run.duration_s) },
    { label: rate.label, value: rate.value, unit: rate.unit },
    { label: "Splits", value: String(run.splits.length) },
  ];

  return (
    <div className="relative h-full">
      {/* The route you actually ran, as the backdrop. */}
      <div className="absolute inset-x-0 top-0 h-[38%]">
        {geometry ? (
          <RouteMap geometry={geometry} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface">
            <p className="rg-label">No route recorded</p>
          </div>
        )}
      </div>

      <div className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top))] z-30">
        <BackLink floating />
      </div>

      <div className="absolute inset-x-0 bottom-0 top-[34%] z-20 overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-hairline bg-surface px-5 pb-8 pt-6">
        <p className="rg-label">{DATE_FORMAT.format(new Date(run.started_at))}</p>
        <h1 className="mt-2 text-lg font-semibold text-ink">
          {run.route_name ?? "Run"}
        </h1>

        {/* The one number this screen leads with. Proportional figures: at this
            size tabular digits read loose. */}
        <p className="rg-metric mt-5 text-[64px] leading-none text-ink [font-variant-numeric:proportional-nums]">
          {Number(run.distance_km).toFixed(2)}
          <span className="ml-2 align-baseline text-xl text-muted">km</span>
        </p>

        <dl className="mt-7 grid grid-cols-3 gap-3 border-t border-hairline pt-6">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse">
              <dt className="rg-label mt-1.5">{stat.label}</dt>
              <dd className="rg-metric text-2xl text-ink">
                {stat.value}
                {stat.unit && (
                  <span className="ml-1 text-sm text-muted">{stat.unit}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {run.splits.length > 0 && (
          <div className="mt-8 border-t border-hairline pt-6">
            <SplitsChart splits={run.splits} />
          </div>
        )}
      </div>
    </div>
  );
}

function BackLink({ floating = false }: { floating?: boolean }) {
  return (
    <Link
      href="/activity"
      aria-label="Back to activity"
      className={
        floating
          ? "flex h-11 w-11 items-center justify-center rounded-full border border-hairline bg-surface text-ink transition-colors hover:bg-raised"
          : "inline-flex items-center gap-2 text-sm font-semibold text-muted transition-colors hover:text-ink"
      }
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="m15 18-6-6 6-6" />
      </svg>
      {!floating && "Activity"}
    </Link>
  );
}
