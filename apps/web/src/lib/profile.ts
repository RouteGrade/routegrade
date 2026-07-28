import type { RecordedRun } from "@/lib/api/runs-client";
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
  fastestPaceSPerKm: PersonalBest | null;
  longestDurationS: PersonalBest | null;
};

/**
 * Short runs are excluded from the pace record. Pace over a few hundred metres
 * is mostly GPS noise and a standing-start artefact, and letting it stand as a
 * personal best would park an unbeatable number on the profile forever.
 */
export const MIN_PACE_RECORD_KM = 1;

/** Records across a run history. Ties keep the earlier run in the list. */
export function personalBests(runs: RecordedRun[]): PersonalBests {
  const bests: PersonalBests = {
    longestDistanceKm: null,
    fastestPaceSPerKm: null,
    longestDurationS: null,
  };

  for (const run of runs) {
    const distanceKm = Number(run.distance_km) || 0;
    const durationS = Number(run.duration_s) || 0;
    const at = { runId: run.id, startedAt: run.started_at };

    if (
      distanceKm > 0 &&
      distanceKm > (bests.longestDistanceKm?.value ?? 0)
    ) {
      bests.longestDistanceKm = { ...at, value: distanceKm };
    }

    if (durationS > 0 && durationS > (bests.longestDurationS?.value ?? 0)) {
      bests.longestDurationS = { ...at, value: durationS };
    }

    // Derived from distance and duration rather than read from
    // `avg_pace_s_per_km`, which is nullable and is the server's own rounding
    // of the same two numbers.
    if (distanceKm >= MIN_PACE_RECORD_KM && durationS > 0) {
      const paceSPerKm = Math.round(durationS / distanceKm);
      const best = bests.fastestPaceSPerKm;
      if (best === null || paceSPerKm < best.value) {
        bests.fastestPaceSPerKm = { ...at, value: paceSPerKm };
      }
    }
  }

  return bests;
}

/** The subset of a saved route the grade profile needs. */
export type GradedRoute = {
  grade: Grade;
  score: number;
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
