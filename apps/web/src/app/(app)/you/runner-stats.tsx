"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { summarizeRuns } from "@/lib/activity";
import { listSavedRoutes, type SavedRoute } from "@/lib/api/routes-client";
import { listRuns, type RecordedRun } from "@/lib/api/runs-client";
import { formatPace, formatTotalTime } from "@/lib/geo";
import {
  GRADE_ORDER,
  MIN_PACE_RECORD_KM,
  personalBests,
  summarizeRouteGrades,
  type PersonalBest,
} from "@/lib/profile";

/**
 * The runner half of the You tab: lifetime totals, personal bests, and the
 * grade profile of the routes they keep.
 *
 * Loads runs and saved routes independently so a failure in one never blanks
 * the other, and so neither blocks the profile block above it.
 */

type Load<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error" };

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function RunnerStats() {
  const [runs, setRuns] = useState<Load<RecordedRun[]>>({ kind: "loading" });
  const [routes, setRoutes] = useState<Load<SavedRoute[]>>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    listRuns()
      .then((data) => !cancelled && setRuns({ kind: "ready", data }))
      .catch(() => !cancelled && setRuns({ kind: "error" }));
    listSavedRoutes()
      .then((data) => !cancelled && setRoutes({ kind: "ready", data }))
      .catch(() => !cancelled && setRoutes({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Lifetime runs={runs} />
      <Records runs={runs} />
      <GradeProfileSection routes={routes} />
    </>
  );
}

function Lifetime({ runs }: { runs: Load<RecordedRun[]> }) {
  // Zeroes rather than an empty state: a brand-new runner's profile should
  // still show the shape of what it will fill in, the way a race bib does.
  const totals = summarizeRuns(runs.kind === "ready" ? runs.data : []);

  const stats = [
    { label: "Distance", value: totals.distanceKm.toFixed(1), unit: "km" },
    { label: "Runs", value: String(totals.runs) },
    { label: "Time", value: formatTotalTime(totals.durationS) },
    {
      label: "Avg pace",
      value:
        totals.avgPaceSPerKm !== null ? formatPace(totals.avgPaceSPerKm) : "—:—",
      unit: totals.avgPaceSPerKm !== null ? "/km" : undefined,
    },
  ];

  return (
    <section aria-label="Lifetime totals" className="mt-8">
      <h2 className="rg-label mb-3">Lifetime</h2>
      {runs.kind === "error" ? (
        <p className="text-sm text-muted">We couldn&apos;t load your totals.</p>
      ) : (
        <dl
          className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-hairline"
          aria-busy={runs.kind === "loading"}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse bg-surface p-5">
              <dt className="rg-label mt-1.5">{stat.label}</dt>
              <dd className="rg-metric text-[32px] text-ink [font-variant-numeric:proportional-nums]">
                {stat.value}
                {stat.unit && (
                  <span className="ml-1.5 text-sm text-muted">{stat.unit}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Records({ runs }: { runs: Load<RecordedRun[]> }) {
  if (runs.kind !== "ready") return null;

  const bests = personalBests(runs.data);
  const rows: { label: string; value: string; best: PersonalBest }[] = [];

  if (bests.longestDistanceKm) {
    rows.push({
      label: "Longest run",
      value: `${bests.longestDistanceKm.value.toFixed(2)} km`,
      best: bests.longestDistanceKm,
    });
  }
  if (bests.fastestPaceSPerKm) {
    rows.push({
      label: `Fastest pace (${MIN_PACE_RECORD_KM} km+)`,
      value: `${formatPace(bests.fastestPaceSPerKm.value)} /km`,
      best: bests.fastestPaceSPerKm,
    });
  }
  if (bests.longestDurationS) {
    rows.push({
      label: "Longest time",
      value: formatTotalTime(bests.longestDurationS.value),
      best: bests.longestDurationS,
    });
  }

  // Nothing to celebrate yet — the lifetime zeroes above already say so.
  if (rows.length === 0) return null;

  return (
    <section aria-label="Personal bests" className="mt-8">
      <h2 className="rg-label mb-3">Records</h2>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label}>
            {/* Every record links to the run that set it — a number with no way
                back to its run is a dead end. */}
            <Link
              href={`/activity/${row.best.runId}`}
              className="flex items-center justify-between gap-4 rounded-card border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {row.label}
                </p>
                <p className="rg-label mt-1">
                  {DATE_FORMAT.format(new Date(row.best.startedAt))}
                </p>
              </div>
              <p className="rg-metric shrink-0 text-xl text-ink">{row.value}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GradeProfileSection({ routes }: { routes: Load<SavedRoute[]> }) {
  if (routes.kind === "loading") return null;

  if (routes.kind === "error") {
    return (
      <section className="mt-8">
        <h2 className="rg-label mb-3">Route grades</h2>
        <p className="text-sm text-muted">
          We couldn&apos;t load your saved routes.
        </p>
      </section>
    );
  }

  const profile = summarizeRouteGrades(routes.data);
  // A null commonest grade with routes present means none of them carried a
  // grade this build recognises — say nothing rather than an empty badge.
  if (profile.routes === 0 || profile.commonestGrade === null) return null;

  const mostCounted = Math.max(...GRADE_ORDER.map((g) => profile.counts[g]));

  return (
    <section aria-label="Route grades" className="mt-8">
      <h2 className="rg-label mb-3">Route grades</h2>
      <div className="rounded-card border border-hairline bg-surface p-5">
        <div className="flex items-center gap-4">
          <span className="rg-display flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-volt text-2xl text-canvas">
            {profile.commonestGrade}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              Most of your routes grade {profile.commonestGrade}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {profile.routes} saved · {profile.averageScore?.toFixed(0)} avg score
            </p>
          </div>
        </div>

        {/* Counts per grade: a magnitude comparison, so one hue and a shared
            scale. The letter carries the identity — colouring the four bars
            differently would encode it twice, and A and B sit too close on the
            grade ramp to be told apart at this size anyway. */}
        <dl className="mt-5 flex flex-col gap-2 border-t border-hairline pt-4">
          {GRADE_ORDER.map((grade) => (
            <div key={grade} className="flex items-center gap-3">
              <dt className="rg-metric w-4 shrink-0 text-sm text-muted">
                {grade}
              </dt>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                <div
                  aria-hidden="true"
                  className="h-full rounded-full bg-volt"
                  style={{
                    width: `${mostCounted > 0 ? (profile.counts[grade] / mostCounted) * 100 : 0}%`,
                  }}
                />
              </div>
              <dd className="rg-metric w-6 shrink-0 text-right text-sm text-ink">
                {profile.counts[grade]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
