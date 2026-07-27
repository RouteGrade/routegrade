"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/shell/screen";
import { ApiError } from "@/lib/api/authenticated-client";
import { deleteRun, listRuns, type RecordedRun } from "@/lib/api/runs-client";
import { formatDuration, formatPace } from "@/lib/geo";

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

  return (
    <>
      {state.kind === "loading" && (
        <p className="text-sm text-muted">Loading your runs…</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-danger">{state.message}</p>
      )}

      {state.kind === "ready" && state.runs.length === 0 && (
        <EmptyState
          title="No runs yet"
          body="Pick a route and hit start — everything you finish lands here."
          cta={{ href: "/", label: "Go for a run" }}
        />
      )}

      {state.kind === "ready" && state.runs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.runs.map((run) => (
            <li
              key={run.id}
              className="rounded-card border border-hairline bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="rg-label">
                    {DATE_FORMAT.format(new Date(run.started_at))}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-ink">
                    {run.route_name ?? "Run"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(run.id)}
                  disabled={deletingId === run.id}
                  aria-label={`Delete run from ${DATE_FORMAT.format(new Date(run.started_at))}`}
                  className="-mr-1.5 -mt-1.5 shrink-0 rounded-full p-2.5 text-faint transition-colors hover:bg-danger-wash hover:text-danger disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>

              <div className="mt-4 flex items-end gap-6">
                <div>
                  <p className="rg-metric text-[44px] text-ink">
                    {Number(run.distance_km).toFixed(2)}
                  </p>
                  <p className="rg-label mt-1">Kilometres</p>
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
            </li>
          ))}
        </ul>
      )}

      {actionError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {actionError}
        </p>
      )}
    </>
  );
}
