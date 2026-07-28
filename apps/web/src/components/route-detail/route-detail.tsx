"use client";

import Link from "next/link";
import type { PlannedRoute } from "@/lib/api/routes-client";
import { GRADE_META, deriveReasons, type Grade } from "@/lib/scorecard";

/**
 * The route detail screen: what you get after RouteGrade finds you something.
 *
 * The grade is the product's whole reason to exist, so it is the largest thing
 * here by a wide margin — a single letter at 88px, ahead of the route's own
 * name. Everything else (stats, the factor breakdown) reads as support for it.
 *
 * Laid out as a tall sheet rather than a true full-screen page so the map keeps
 * showing the route above it; for a route-grading app, hiding the line you are
 * being asked to judge would be the wrong trade.
 */

/** Rough planning pace used for the "est. time" stat. */
const PACE_MIN_PER_KM = 6;

export type RouteDetailProps = {
  route: PlannedRoute;
  /** Sibling candidates to switch between; null when there is only one. */
  candidates: PlannedRoute[] | null;
  activeIndex: number;
  onSelectCandidate: (index: number) => void;
  saved: boolean;
  isAuthenticated: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  /** Persist the in-progress plan before a guest bounces through /login. */
  onStashPlan: () => void;
  onStartRun: () => void;
  onShare: () => void;
};

export function RouteDetail({
  route,
  candidates,
  activeIndex,
  onSelectCandidate,
  saved,
  isAuthenticated,
  saving,
  saveError,
  onSave,
  onStashPlan,
  onStartRun,
  onShare,
}: RouteDetailProps) {
  const meta = GRADE_META[route.grade as Grade] ?? null;
  const estMinutes = Math.round(route.distance_km * PACE_MIN_PER_KM);
  const reasons = deriveReasons(route);
  const factors = [
    { label: "Elevation", value: route.elevation_subscore },
    { label: "Quietness", value: route.intersection_subscore },
    // An older API response (or a saved route predating subscores) omits these
    // entirely — `undefined` must not reach Math.round and render "NaN".
  ].filter((f): f is { label: string; value: number } => Number.isFinite(f.value));

  const stats = [
    { label: "Distance", value: `${route.distance_km.toFixed(1)} km` },
    { label: "Est. time", value: `${estMinutes} min` },
    { label: "Elevation", value: `${Math.round(route.elevation_gain_m)} m` },
  ];

  return (
    <section className="animate-rise-in absolute inset-x-0 bottom-0 z-20 flex max-h-[72%] flex-col rounded-t-[28px] border-t border-hairline bg-surface sm:inset-y-0 sm:right-auto sm:max-h-full sm:w-[420px] sm:rounded-none sm:border-r sm:border-t-0">
      {/* On sm+ this panel runs full height from the top, where the floating
          "back" control sits — pad the content down so the grade clears it
          instead of being overlapped by it. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-6 sm:pt-[calc(5rem+env(safe-area-inset-top))]">
        {candidates && candidates.length > 1 && (
          <div className="mb-6 flex gap-2" role="tablist" aria-label="Route candidates">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={index === activeIndex}
                onClick={() => onSelectCandidate(index)}
                className={`flex-1 rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                  index === activeIndex
                    ? "border-accent bg-accent-wash text-accent"
                    : "border-hairline text-muted hover:border-hairline-strong hover:text-ink"
                }`}
              >
                {candidate.grade} · {candidate.distance_km.toFixed(1)} km
              </button>
            ))}
          </div>
        )}

        {/* The grade, loudest thing on the screen. */}
        <div className="flex items-center gap-5">
          <span
            className="rg-display text-[88px] leading-[0.8] text-accent"
            style={meta ? { color: meta.hexFrom } : undefined}
          >
            {route.grade}
          </span>
          <div className="min-w-0">
            <p className="rg-display text-xl uppercase text-ink">
              {meta?.label ?? "Graded"}
            </p>
            {meta && (
              <p className="mt-1.5 text-sm leading-snug text-muted">{meta.blurb}</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
            {route.name}
          </h2>
          {route.provider === "saved" ? (
            <span className="shrink-0 rounded-full border border-accent/40 bg-accent-wash px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
              Saved
            </span>
          ) : !route.within_tolerance ? (
            <span className="shrink-0 rounded-full border border-hairline-strong px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
              Off target
            </span>
          ) : null}
        </div>

        {/* `dt` must precede `dd` in the markup to be a valid description list;
            flex-col-reverse puts the value on top, where the design wants it,
            without lying about the structure. */}
        <dl className="mt-5 grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse">
              <dt className="rg-label mt-1.5">{stat.label}</dt>
              <dd className="rg-metric text-2xl text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {(factors.length > 0 || reasons.length > 0) && (
          // A labelled region, not a bare div: "Elevation" appears both as a
          // headline stat and as a scoring factor, and this is what lets a
          // screen reader (or a test) tell the two apart.
          <section
            aria-label="Why this grade"
            className="mt-7 border-t border-hairline pt-6"
          >
            <p className="rg-label" aria-hidden="true">
              Why this grade
            </p>

            {factors.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                {factors.map((factor) => (
                  <div key={factor.label} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs font-medium text-muted">
                      {factor.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.round(factor.value)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">
                      {Math.round(factor.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {reasons.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {reasons.map((reason, i) => (
                  <li
                    key={`${reason.key}-${i}`}
                    className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted"
                  >
                    {reason.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* Actions stay pinned: on a long breakdown, "start run" must never be
          the thing you have to scroll to find. */}
      <div className="shrink-0 border-t border-hairline px-5 pb-6 pt-4">
        <button
          type="button"
          onClick={onStartRun}
          className="rg-btn rg-btn-primary w-full text-base"
        >
          Start run
        </button>

        <div className="mt-3 flex gap-3">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saving || saved}
              className={`rg-btn flex-1 ${
                saved
                  ? "cursor-default border border-accent/40 bg-accent-wash text-accent"
                  : "rg-btn-secondary disabled:cursor-wait"
              }`}
            >
              {saved ? "Saved" : saving ? "Saving…" : "Save"}
            </button>
          ) : (
            <Link
              href="/login?next=/"
              onClick={onStashPlan}
              className="rg-btn rg-btn-secondary flex-1 text-[11px]"
            >
              Sign in to save this route
            </Link>
          )}
          <button
            type="button"
            onClick={onShare}
            aria-label="Share scorecard"
            className="rg-btn rg-btn-secondary w-14 px-0"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <path d="M16 6l-4-4-4 4M12 2v13" />
            </svg>
          </button>
        </div>

        {saveError && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {saveError}
          </p>
        )}
      </div>
    </section>
  );
}
