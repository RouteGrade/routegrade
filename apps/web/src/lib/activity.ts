import type { RecordedRun, RunSplit } from "@/lib/api/runs-client";

/**
 * Presentation logic for the Activity tab.
 *
 * Pure and derived-only: lifetime totals are computed from the run list the API
 * already returns (`GET /v1/users/me/runs` includes `splits` and `path`), so the
 * tab needs no aggregate endpoint. If run history ever outgrows a single
 * response, this is the seam to replace with a server-side summary.
 */

export type ActivityTotals = {
  runs: number;
  distanceKm: number;
  durationS: number;
  /** Distance-weighted, not a mean of means; null when nothing has been run. */
  avgPaceSPerKm: number | null;
};

export function summarizeRuns(runs: RecordedRun[]): ActivityTotals {
  let distanceKm = 0;
  let durationS = 0;

  for (const run of runs) {
    // A recorded distance can be 0 (a run abandoned at the start line); that is
    // valid history, it just contributes nothing to pace.
    distanceKm += Number(run.distance_km) || 0;
    durationS += Number(run.duration_s) || 0;
  }

  return {
    runs: runs.length,
    distanceKm,
    durationS,
    // Total time over total distance — a plain average of each run's pace would
    // let a 1 km jog outweigh a 20 km long run.
    avgPaceSPerKm: distanceKm > 0 ? Math.round(durationS / distanceKm) : null,
  };
}

export type SplitRow = {
  km: number;
  durationS: number;
  /** Seconds off this run's average split: negative = faster than average. */
  deltaS: number;
  /** 0..1 magnitude of `deltaS` against the run's largest deviation. */
  magnitude: number;
  /** Marks the single quickest kilometre; ties resolve to the earliest. */
  fastest: boolean;
};

export type SplitsSummary = {
  rows: SplitRow[];
  /** Mean split duration — the axis every row is measured against. */
  averageS: number;
};

/**
 * Turn raw splits into rows measured as *deviation from this run's average*.
 *
 * The question a runner asks of their splits is "which kilometres were faster
 * or slower than the rest?" — polarity, not raw magnitude. Plotting absolute
 * durations from a zero baseline answers it badly: every kilometre of a run
 * takes broadly similar time, so the bars come out near-identical and the chart
 * says less than the numbers beside it. Measuring against the average puts the
 * variation on the scale, and the renderer encodes the sign by which side of
 * centre a bar sits on rather than by colour.
 */
export function summarizeSplits(splits: RunSplit[]): SplitsSummary {
  const usable = splits.filter(
    (s) => Number.isFinite(s.duration_s) && s.duration_s > 0,
  );
  if (usable.length === 0) return { rows: [], averageS: 0 };

  const averageS =
    usable.reduce((sum, s) => sum + s.duration_s, 0) / usable.length;
  const largestDeviation = Math.max(
    ...usable.map((s) => Math.abs(s.duration_s - averageS)),
  );

  const quickest = Math.min(...usable.map((s) => s.duration_s));
  const slowest = Math.max(...usable.map((s) => s.duration_s));
  // Nothing to single out when there is one split, or when they are all equal.
  const markFastest = usable.length > 1 && quickest < slowest;
  let marked = false;

  const rows = usable.map((split) => {
    const fastest = markFastest && !marked && split.duration_s === quickest;
    if (fastest) marked = true;
    const deltaS = split.duration_s - averageS;
    return {
      km: split.km,
      durationS: split.duration_s,
      deltaS,
      // All-equal splits have no deviation to scale against; every bar is 0.
      magnitude: largestDeviation > 0 ? Math.abs(deltaS) / largestDeviation : 0,
      fastest,
    };
  });

  return { rows, averageS };
}
