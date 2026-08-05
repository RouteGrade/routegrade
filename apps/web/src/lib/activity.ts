import type { RecordedRun, RunSplit } from "@/lib/api/runs-client";

/**
 * Presentation logic for the Activity tab.
 *
 * Pure and derived-only: totals are computed from the run list the API already
 * returns (`GET /v1/users/me/runs` includes `splits` and `path`), so the tab
 * needs no aggregate endpoint. If run history ever outgrows a single response,
 * this is the seam to replace with a server-side summary — note that period
 * scoping would have to move server-side with it.
 */

export type ActivityTotals = {
  /** Recorded runs. Rides are counted separately — see `rides`. */
  runs: number;
  rides: number;
  /** Distance and time across everything: both are honest sums of both. */
  distanceKm: number;
  durationS: number;
  /**
   * Distance-weighted pace across RUNS ONLY; null when nothing was run.
   *
   * Rides are excluded deliberately rather than incidentally. A ride covers
   * three to four times the ground per minute, so folding one into this figure
   * does not nudge it — it swamps it, and reports a pace the runner never ran.
   */
  avgPaceSPerKm: number | null;
  /** Distance-weighted speed across RIDES ONLY; null when nothing was ridden. */
  avgSpeedKmh: number | null;
};

/** Total distance and time over a subset, plus the rate that spans them. */
function rateOver(entries: RecordedRun[]): { km: number; s: number } {
  let km = 0;
  let s = 0;
  for (const entry of entries) {
    // A recorded distance can be 0 (abandoned at the start line); that is valid
    // history, it just contributes nothing to the rate.
    km += Number(entry.distance_km) || 0;
    s += Number(entry.duration_s) || 0;
  }
  return { km, s };
}

export function summarizeRuns(runs: RecordedRun[]): ActivityTotals {
  const onlyRuns = runs.filter((r) => r.activity !== "ride");
  const onlyRides = runs.filter((r) => r.activity === "ride");

  const all = rateOver(runs);
  const ran = rateOver(onlyRuns);
  const rode = rateOver(onlyRides);

  return {
    runs: onlyRuns.length,
    rides: onlyRides.length,
    distanceKm: all.km,
    durationS: all.s,
    // Total time over total distance — a plain average of each run's pace would
    // let a 1 km jog outweigh a 20 km long run.
    avgPaceSPerKm: ran.km > 0 ? Math.round(ran.s / ran.km) : null,
    avgSpeedKmh: rode.s > 0 ? (rode.km / rode.s) * 3600 : null,
  };
}

/**
 * The windows the Activity tab totals over. Lifetime deliberately isn't one —
 * that figure belongs to the You tab, and having both tabs report it made the
 * same four numbers appear twice in the app.
 */
export const PERIODS = ["week", "month", "year"] as const;

export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  week: "This week",
  month: "This month",
  year: "This year",
};

/**
 * Start of the calendar period containing `now`, in the viewer's own timezone —
 * a runner's "this week" is the one they lived, not a UTC one.
 *
 * Weeks start Monday: a Sunday long run belongs to the week it finished, and
 * treating it as the start of a new week splits most training weeks in half.
 */
export function periodStart(period: Period, now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "week") {
    // getDay() is 0 for Sunday, which is 6 days into a Monday-first week.
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (period === "month") {
    start.setDate(1);
  } else {
    start.setMonth(0, 1);
  }

  return start;
}

/** Runs started within the calendar period containing `now`. */
export function runsWithin(
  runs: RecordedRun[],
  period: Period,
  now: Date,
): RecordedRun[] {
  const start = periodStart(period, now).getTime();
  return runs.filter((run) => {
    const startedAt = new Date(run.started_at).getTime();
    // A run with an unparseable date is dropped from period views rather than
    // silently counted into whichever period NaN happens to fall outside.
    return Number.isFinite(startedAt) && startedAt >= start;
  });
}

/** Totals over one calendar period — the same shape as lifetime totals. */
export function summarizePeriod(
  runs: RecordedRun[],
  period: Period,
  now: Date,
): ActivityTotals {
  return summarizeRuns(runsWithin(runs, period, now));
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
