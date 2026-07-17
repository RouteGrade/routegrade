"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/authenticated-client";
import {
  deleteSavedRoute,
  listSavedRoutes,
  type SavedRoute,
} from "@/lib/api/routes-client";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; routes: SavedRoute[] }
  | { kind: "error"; message: string };

export function SavedRoutesSection() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const routes = await listSavedRoutes();
        if (!cancelled) setState({ kind: "ready", routes });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err instanceof ApiError && err.status === 401
              ? "Your session expired. Please sign in again."
              : "We couldn't load your saved routes.",
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
      await deleteSavedRoute(id);
      setState({
        kind: "ready",
        routes: state.routes.filter((route) => route.id !== id),
      });
    } catch {
      setActionError("Couldn't delete that route. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mt-8 border-t border-white/10 pt-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        Saved routes
      </h2>

      {state.kind === "loading" && (
        <p className="mt-3 text-sm text-zinc-400">Loading your routes…</p>
      )}

      {state.kind === "error" && (
        <p className="mt-3 text-sm text-rose-300">{state.message}</p>
      )}

      {state.kind === "ready" && state.routes.length === 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-5 text-center">
          <p className="text-sm font-medium text-zinc-300">No saved routes yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Plan a route on the map and hit <span className="text-emerald-400">Save</span> to
            keep it here.
          </p>
          <Link
            href="/"
            className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-linear-to-r from-emerald-400 to-cyan-400 px-4 text-xs font-bold text-zinc-950 transition hover:brightness-110"
          >
            Find a route
          </Link>
        </div>
      )}

      {state.kind === "ready" && state.routes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {state.routes.map((route) => (
            <li
              key={route.id}
              className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-emerald-400/30 hover:bg-white/[0.08]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-emerald-400 to-lime-400 font-display text-sm font-extrabold text-zinc-950">
                {route.grade}
              </span>
              <Link href={`/?route=${route.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white group-hover:text-emerald-200">
                  {route.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-400">
                  {Number(route.distance_km).toFixed(1)} km ·{" "}
                  {Math.round(Number(route.elevation_gain_m))} m climb · {route.preference}
                  {route.starting_address ? ` · ${route.starting_address}` : ""}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => onDelete(route.id)}
                disabled={deletingId === route.id}
                aria-label={`Delete ${route.name}`}
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
