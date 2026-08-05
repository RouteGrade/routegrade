"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActivityIcon } from "@/components/activity/activity-icon";
import { BrandLoader } from "@/components/brand/brand-loader";
import { EmptyState } from "@/components/shell/screen";
import {
  ACTIVITY_FILTER_LABEL,
  ACTIVITY_FILTERS,
  activityCopy,
  activityOf,
  filterByActivity,
  hasMixedActivities,
  type ActivityFilter,
} from "@/lib/activity-type";
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
  const [filter, setFilter] = useState<ActivityFilter>("all");

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

  const allRoutes = state.kind === "ready" ? state.routes : [];
  const visible = filterByActivity(allRoutes, filter);
  // Only worth offering once there is something on both sides of it.
  const showFilter = hasMixedActivities(allRoutes);

  return (
    <>
      {state.kind === "loading" && (
        <BrandLoader label="Loading your routes" />
      )}

      {/* role="alert" so the failure is announced, matching the delete error
          below and the other two account tabs. Without it a screen-reader user
          got silence on the load failure while still hearing the delete one,
          which is the wrong way round. */}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && state.routes.length === 0 && (
        <EmptyState
          title="Nothing saved"
          body="Plan or build a route, then save it to keep it here."
          cta={{ href: "/", label: "Find a route" }}
        />
      )}

      {/* Mirrors the planner's Run/Ride control — same shape, same glyphs — so
          the split reads as one idea the app has rather than two coincidences.
          A radiogroup rather than tabs: it filters one list in place, it does
          not swap between two panels. */}
      {showFilter && (
        <div
          role="radiogroup"
          aria-label="Filter routes by activity"
          className="mb-3 flex rounded-full border border-hairline bg-surface p-1"
        >
          {ACTIVITY_FILTERS.map((option) => {
            const selected = filter === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFilter(option)}
                className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-colors ${
                  selected ? "bg-accent text-canvas" : "text-muted hover:text-ink"
                }`}
              >
                {option !== "all" && <ActivityIcon activity={option} className="h-3.5 w-3.5" />}
                {ACTIVITY_FILTER_LABEL[option]}
              </button>
            );
          })}
        </div>
      )}

      {/* Reachable only with the filter on, since an empty library shows the
          empty state above. Says which filter is hiding things, so the fix is
          obvious rather than looking like the routes were lost. */}
      {state.kind === "ready" && state.routes.length > 0 && visible.length === 0 && (
        <p className="rounded-card border border-hairline bg-surface px-4 py-6 text-center text-sm text-muted">
          No {filter === "ride" ? "rides" : "runs"} saved yet.
        </p>
      )}

      {state.kind === "ready" && visible.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visible.map((route) => (
            <li
              key={route.id}
              className="group flex items-center gap-4 rounded-card border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong"
            >
              <span className="rg-display flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-lg text-canvas">
                {route.grade}
              </span>
              <Link href={`/?route=${route.id}`} className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-base font-semibold text-ink">
                  <span className="truncate">{route.name}</span>
                  {/* The icon is decorative; the activity is carried in the
                      stats line below, where it is readable and announced. A
                      route that reopens as a ride has to say so before it is
                      opened, or the Run/Ride toggle flipping on arrival looks
                      like the app changed its mind. */}
                  <ActivityIcon
                    activity={activityOf(route)}
                    className="h-3.5 w-3.5 shrink-0 text-muted"
                  />
                </p>
                <p className="mt-0.5 truncate text-xs uppercase tracking-wider text-faint">
                  {activityCopy(activityOf(route)).toggleLabel} ·{" "}
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
