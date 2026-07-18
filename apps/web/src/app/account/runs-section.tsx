"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/authenticated-client";
import { deleteRun, listRuns, type RecordedRun } from "@/lib/api/runs-client";
import { formatDuration, formatPace } from "@/lib/geo";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; runs: RecordedRun[] }
  | { kind: "error"; message: string };

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
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
    <section className="mt-8 border-t border-white/10 pt-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        Your runs
      </h2>

      {state.kind === "loading" && (
        <p className="mt-3 text-sm text-zinc-400">Loading your runs…</p>
      )}

      {state.kind === "error" && (
        <p className="mt-3 text-sm text-rose-300">{state.message}</p>
      )}

      {state.kind === "ready" && state.runs.length === 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-center">
          <p className="text-sm font-medium text-zinc-300">No runs yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Pick a route on the map and hit{" "}
            <span className="text-emerald-400">Start run</span> — your finished runs land
            here.
          </p>
          <Link
            href="/"
            className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-linear-to-r from-emerald-400 to-cyan-400 px-4 text-xs font-bold text-zinc-950 transition hover:brightness-110"
          >
            Go for a run
          </Link>
        </div>
      )}

      {state.kind === "ready" && state.runs.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {state.runs.map((run) => (
            <li
              key={run.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-sky-400 to-cyan-400 text-zinc-950">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M13 4a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
                  <path d="M4 17l5 1 .75-1.5" />
                  <path d="M15 21v-4l-4-3 1-6" />
                  <path d="M7 12V9l5-1 3 3 3 1" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {run.route_name ?? "Run"}
                </p>
                <p className="mt-0.5 truncate text-xs tabular-nums text-zinc-400">
                  {DATE_FORMAT.format(new Date(run.started_at))} ·{" "}
                  {Number(run.distance_km).toFixed(2)} km · {formatDuration(run.duration_s)}
                  {run.avg_pace_s_per_km !== null
                    ? ` · ${formatPace(run.avg_pace_s_per_km)} /km`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(run.id)}
                disabled={deletingId === run.id}
                aria-label={`Delete run from ${DATE_FORMAT.format(new Date(run.started_at))}`}
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-400 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
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
      )}

      {actionError && (
        <p role="alert" className="mt-2 text-xs text-rose-400">
          {actionError}
        </p>
      )}
    </section>
  );
}
