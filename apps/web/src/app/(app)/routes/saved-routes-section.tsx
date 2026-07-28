"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand/brand-loader";
import { EmptyState } from "@/components/shell/screen";
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
    <>
      {state.kind === "loading" && (
        <BrandLoader label="Loading your routes" />
      )}

      {state.kind === "error" && (
        <p className="text-sm text-danger">{state.message}</p>
      )}

      {state.kind === "ready" && state.routes.length === 0 && (
        <EmptyState
          title="Nothing saved"
          body="Plan or build a route, then save it to keep it here."
          cta={{ href: "/", label: "Find a route" }}
        />
      )}

      {state.kind === "ready" && state.routes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.routes.map((route) => (
            <li
              key={route.id}
              className="group flex items-center gap-4 rounded-card border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong"
            >
              <span className="rg-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-lg text-canvas">
                {route.grade}
              </span>
              <Link href={`/?route=${route.id}`} className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink">
                  {route.name}
                </p>
                <p className="mt-0.5 truncate text-xs uppercase tracking-wider text-faint">
                  {Number(route.distance_km).toFixed(1)} km ·{" "}
                  {Math.round(Number(route.elevation_gain_m))} m · {route.preference}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => onDelete(route.id)}
                disabled={deletingId === route.id}
                aria-label={`Delete ${route.name}`}
                className="shrink-0 rounded-full p-2.5 text-faint transition-colors hover:bg-danger-wash hover:text-danger disabled:opacity-50"
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
        <p role="alert" className="mt-2 text-xs text-danger">
          {actionError}
        </p>
      )}
    </>
  );
}
