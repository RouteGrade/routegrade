"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand/brand-loader";
import { EmptyState } from "@/components/shell/screen";
import {
  PERIOD_LABEL,
  PERIODS,
  summarizePeriod,
  type Period,
} from "@/lib/activity";
import { ApiError } from "@/lib/api/authenticated-client";
import { deleteRun, listRuns, type RecordedRun } from "@/lib/api/runs-client";
import { formatDuration, formatPace, formatTotalTime } from "@/lib/geo";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; runs: RecordedRun[] }
  | { kind: "error"; message: string };

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function RunsSection() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Month, not week: for anyone running a few times a week, "this week" is
  // often empty early on, and a tab that opens on 0.0 km reads as broken.
  const [period, setPeriod] = useState<Period>("month");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const runs = await listRuns();
        if (!cancelled) setState({ kind: "ready", runs });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err instanceof ApiError && err.status === 401
              ? "Your session expired. Please sign in again."
              : "We couldn't load your runs.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDelete(id: string) {
    if (deletingId || state.kind !== "ready") return;
    setDeletingId(id);
    setActionError(null);
    try {
      await deleteRun(id);
      setState({
        kind: "ready",
        runs: state.runs.filter((run) => run.id !== id),
      });
    } catch {
      setActionError("Couldn't delete that run. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  if (state.kind === "loading") {
    return <BrandLoader label="Loading your runs" />;
  }

  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.message}
      </p>
    );
  }

  if (state.runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        body="Pick a route and hit start — everything you finish lands here."
        cta={{ href: "/", label: "Go for a run" }}
      />
    );
  }

  // `now` is read at render rather than held in state: the totals are a
  // snapshot of the moment the tab was opened, and a tab left open across
  // midnight re-reads it on the next interaction anyway.
  const totals = summarizePeriod(state.runs, period, new Date());

  return (
    <>
      {/* Period totals. Lifetime figures live on the You tab — this tab answers
          "how am I doing lately?", which is a question with a horizon. */}
      <section aria-label="Totals" className="mb-8">
        {/* A group of toggle buttons rather than a tablist: there are no tab
            panels here, only one figure that re-reads itself. */}
        <div
          role="group"
          aria-label="Totals period"
          className="mb-5 flex gap-1 rounded-control bg-surface p-1"
        >
          {PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === period}
              onClick={() => setPeriod(option)}
              className={`rg-label flex-1 rounded-[10px] py-2.5 transition-colors ${
                option === period
                  ? "bg-accent text-canvas"
                  : "text-muted hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <p className="rg-metric text-[64px] leading-none text-ink [font-variant-numeric:proportional-nums]">
          {totals.distanceKm.toFixed(1)}
          <span className="ml-2 align-baseline text-xl text-muted">km</span>
        </p>
        <p className="rg-label mt-2">{PERIOD_LABEL[period]}</p>

        <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-hairline pt-5">
          {[
            { label: "Runs", value: String(totals.runs) },
            // Hours-and-minutes rather than a stopwatch reading, matching the
            // You tab's Time tile.
            { label: "Time", value: formatTotalTime(totals.durationS) },
            {
              label: "Avg pace",
              value:
                totals.avgPaceSPerKm !== null
                  ? formatPace(totals.avgPaceSPerKm)
                  : "—:—",
            },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse">
              <dt className="rg-label mt-1.5">{stat.label}</dt>
              <dd className="rg-metric text-xl text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <h2 className="rg-label mb-3">History</h2>
      <ul className="flex flex-col gap-2">
        {state.runs.map((run) => (
          <li
            key={run.id}
            className="relative rounded-card border border-hairline bg-surface transition-colors hover:border-hairline-strong"
          >
            {/* The whole card is the link; the delete button sits above it in
                the stacking order so it stays independently clickable. */}
            <Link href={`/activity/${run.id}`} className="block p-5">
              <p className="rg-label">
                {DATE_FORMAT.format(new Date(run.started_at))}
              </p>
              <p className="mt-1 truncate pr-10 text-sm font-semibold text-ink">
                {run.route_name ?? "Run"}
              </p>

              <div className="mt-4 flex items-end gap-6">
                <div>
                  <p className="rg-metric text-[44px] leading-none text-ink [font-variant-numeric:proportional-nums]">
                    {Number(run.distance_km).toFixed(2)}
                  </p>
                  <p className="rg-label mt-1.5">Kilometres</p>
                </div>
                <div className="flex flex-1 gap-6 pb-1">
                  <div>
                    <p className="rg-metric text-lg text-ink">
                      {formatDuration(run.duration_s)}
                    </p>
                    <p className="rg-label mt-1">Time</p>
                  </div>
                  {run.avg_pace_s_per_km !== null && (
                    <div>
                      <p className="rg-metric text-lg text-ink">
                        {formatPace(run.avg_pace_s_per_km)}
                      </p>
                      <p className="rg-label mt-1">Pace /km</p>
                    </div>
                  )}
                </div>
              </div>
            </Link>

            <button
              type="button"
              onClick={() => onDelete(run.id)}
              disabled={deletingId === run.id}
              aria-label={`Delete run from ${DATE_FORMAT.format(new Date(run.started_at))}`}
              className="absolute right-3 top-3 z-10 rounded-full p-2.5 text-faint transition-colors hover:bg-danger-wash hover:text-danger disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {actionError && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {actionError}
        </p>
      )}
    </>
  );
}
