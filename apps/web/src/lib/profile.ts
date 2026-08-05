import { activityOf } from "@/lib/activity-type";
import type { Activity } from "@/lib/api/routes-client";
import type { RecordedRun, RunSplit } from "@/lib/api/runs-client";
import type { Grade } from "@/lib/scorecard";

/**
 * Presentation logic for the You tab.
 *
 * Like `lib/activity.ts`, everything here is pure and derived from records the
 * API already returns (`GET /v1/users/me/runs`, `GET /v1/users/me/routes`), so
 * the tab needs no aggregate endpoint. Lifetime totals themselves come from
 * `summarizeRuns` — this module adds the two things that make the tab a runner
 * profile rather than a second copy of Activity: personal bests, and the grade
 * profile of the routes they keep.
 */

/** A single record, tied back to the run that set it. */
export type PersonalBest = {
  runId: string;
  startedAt: string;
  /** The record figure, in the unit named by the field holding it. */
  value: number;
};

export type PersonalBests = {
  longestDistanceKm: PersonalBest | null;
  longestDurationS: PersonalBest | null;
  /** Longest ride, kept apart so it can never be read as a running record. */
  longestRideKm: PersonalBest | null;
};

/**
 * "How far" and "how long" records. Speed records live in `distanceRecords`,
 * which measures it over a fixed distance rather than over a whole run.
 *
 * RUNS AND RIDES ARE KEPT APART. A rider covers 40 km on an easy afternoon, so
 * a combined "longest" makes every running record unreachable the first time
 * someone rides, and reports a distance they never ran. The ride equivalent is
 * reported as its own record instead of being dropped.
 *
 * Ties keep the earlier run in the list.
 */
export function personalBests(entries: RecordedRun[]): PersonalBests {
  const bests: PersonalBests = {
    longestDistanceKm: null,
    longestDurationS: null,
    longestRideKm: null,
  };

  for (const entry of entries) {
    if (entry.activity === "ride") {
      const rideKm = Number(entry.distance_km) || 0;
      if (rideKm > (bests.longestRideKm?.value ?? 0)) {
        bests.longestRideKm = {
          runId: entry.id,
          startedAt: entry.started_at,
          value: rideKm,
        };
      }
      continue;
    }
    const run = entry;
    const distanceKm = Number(run.distance_km) || 0;
    const durationS = Number(run.duration_s) || 0;
    const at = { runId: run.id, startedAt: run.started_at };

    if (distanceKm > 0 && distanceKm > (bests.longestDistanceKm?.value ?? 0)) {
      bests.longestDistanceKm = { ...at, value: distanceKm };
    }

    if (durationS > 0 && durationS > (bests.longestDurationS?.value ?? 0)) {
      bests.longestDurationS = { ...at, value: durationS };
    }
  }

  return bests;
}

/**
 * The distances a speed record is kept over.
 *
 * 21 rather than 21.0975: splits are recorded per whole kilometre (see
 * `run-tracker.tsx`), so the last 97.5 m of a half marathon is not a figure we
 * hold. Reporting a 21 km time under a "half marathon" label would claim a time
 * for a distance that was never measured, so the bracket is named for what it
 * actually is.
 */
export const DISTANCE_BRACKETS = [1, 5, 10, 21] as const;

export type BracketKm = (typeof DISTANCE_BRACKETS)[number];

export type DistanceRecord = {
  km: BracketKm;
  /** Quickest time recorded over this distance. */
  durationS: number;
  runId: string;
  startedAt: string;
};

/**
 * Fastest time over each bracket distance, best-known-first.
 *
 * Measured as a rolling window over a run's kilometre splits, so "fastest 5 km"
 * is the quickest five *consecutive whole kilometres* of any run — not
 * necessarily the quickest 5 km stretch, which could start mid-kilometre. Whole
 * splits are the finest granularity the recorder stores; a truer answer would
 * need the raw GPS trace re-walked, which is a much heavier job for a figure
 * that would move by seconds.
 *
 * RIDES ARE EXCLUDED. "Fastest 5 km" is a running record; a bike covers the
 * same five kilometres in a third of the time, so one ride would take every
 * bracket permanently and the board would stop describing the runner at all.
 *
 * Brackets nobody has run far enough to set are omitted rather than shown
 * empty. Ties keep the earlier run in the list.
 */
export function distanceRecords(entries: RecordedRun[]): DistanceRecord[] {
  const records: DistanceRecord[] = [];
  const runs = entries.filter((entry) => entry.activity !== "ride");

  for (const bracket of DISTANCE_BRACKETS) {
    let best: DistanceRecord | null = null;

    for (const run of runs) {
      const durationS = fastestWindow(run.splits, bracket);
      if (durationS === null) continue;
      if (best === null || durationS < best.durationS) {
        best = {
          km: bracket,
          durationS,
          runId: run.id,
          startedAt: run.started_at,
        };
      }
    }

    if (best) records.push(best);
  }

  return records;
}

/**
 * Quickest run of `size` consecutive kilometre splits, or null when the run has
 * no such stretch.
 */
function fastestWindow(splits: RunSplit[], size: number): number | null {
  const usable = [...splits]
    .filter((s) => Number.isFinite(s.duration_s) && s.duration_s > 0)
    .sort((a, b) => a.km - b.km);
  if (usable.length < size) return null;

  let fastest: number | null = null;
  for (let start = 0; start + size <= usable.length; start += 1) {
    const end = start + size - 1;
    // The recorder writes one split per whole kilometre, so a gap in the
    // numbering means kilometres are missing and the window would silently
    // span a distance longer than the bracket.
    if (usable[end].km - usable[start].km !== size - 1) continue;

    let total = 0;
    for (let i = start; i <= end; i += 1) total += usable[i].duration_s;
    if (fastest === null || total < fastest) fastest = total;
  }

  return fastest;
}

/** The subset of a saved route the grade profile needs. */
export type GradedRoute = {
  grade: Grade;
  score: number;
  /** Legacy routes have none; `activityOf` reads those as a run. */
  activity?: Activity | null;
};

export type GradeProfile = {
  routes: number;
  /** How many saved routes earned each grade; always has all four keys. */
  counts: Record<Grade, number>;
  /** Mean score across saved routes; null when nothing is saved. */
  averageScore: number | null;
  /** The grade earned most often. Ties break toward the better grade. */
  commonestGrade: Grade | null;
};

/** Best to worst — the order the distribution is read and ties are broken in. */
export const GRADE_ORDER: Grade[] = ["A", "B", "C", "D"];

/**
 * Summarise the grades of the routes a runner keeps.
 *
 * Reports the *commonest* grade rather than converting the average score back
 * into a letter: the score-to-letter thresholds live in the scoring service
 * (`services/api/app/services/scoring.py`), and a second copy of them here
 * would drift the moment they are tuned. Counting letters the server already
 * assigned needs no such duplication.
 */
export function summarizeRouteGrades(routes: GradedRoute[]): GradeProfile {
  const counts: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
  let scoreTotal = 0;

  for (const route of routes) {
    if (route.grade in counts) counts[route.grade] += 1;
    scoreTotal += Number(route.score) || 0;
  }

  let commonestGrade: Grade | null = null;
  for (const grade of GRADE_ORDER) {
    if (counts[grade] === 0) continue;
    // Walking best-to-worst with a strict `>` keeps the better grade on a tie.
    if (commonestGrade === null || counts[grade] > counts[commonestGrade]) {
      commonestGrade = grade;
    }
  }

  return {
    routes: routes.length,
    counts,
    averageScore: routes.length > 0 ? scoreTotal / routes.length : null,
    commonestGrade,
  };
}

/** One activity's grade profile, tagged so the UI can name it. */
export type ActivityGradeProfile = GradeProfile & { activity: Activity };

/**
 * Grade profiles split by what each route was planned for, best-populated
 * activity first.
 *
 * Splitting matters more here than it looks. The grade measures how good a
 * route is *for the thing you do on it* — a wide arterial with few crossings is
 * a fine ride and a miserable run, and the scoring service weighs it that way.
 * Averaging both into "most of your routes grade B" therefore mixes two
 * different judgements into one letter that answers neither question.
 *
 * Activities with nothing saved are omitted rather than shown empty, so a
 * runner who has never saved a ride sees exactly what they saw before.
 */
export function routeGradesByActivity(
  routes: GradedRoute[],
): ActivityGradeProfile[] {
  const buckets: Record<Activity, GradedRoute[]> = { run: [], ride: [] };
  for (const route of routes) buckets[activityOf(route)].push(route);

  return (["run", "ride"] as const)
    .filter((activity) => buckets[activity].length > 0)
    .map((activity) => ({
      activity,
      ...summarizeRouteGrades(buckets[activity]),
    }))
    // Most-saved first: whichever the runner mostly does should lead, rather
    // than "run" always winning a board that a rider fills.
    .sort((a, b) => b.routes - a.routes);
}
