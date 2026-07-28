/**
 * Scorecard presentation logic.
 *
 * Turns a route's *already-computed* grade and metrics into plain-language
 * reasons for the shareable scorecard, plus the copy used when sharing. This
 * module is pure and READ-ONLY with respect to scoring: it never re-derives a
 * grade, it only phrases the signals the scoring engine already surfaced
 * (elevation gain, intersection density, sidewalk coverage, distance). If a
 * signal is unknown (e.g. sidewalk coverage in v1) it is honestly omitted
 * rather than invented.
 */

export type Grade = "A" | "B" | "C" | "D";

/** The subset of a planned/saved route the scorecard needs. */
export type ScorecardRoute = {
  name: string;
  grade: Grade;
  score: number;
  distance_km: number;
  elevation_gain_m: number;
  // null == unknown (e.g. a legacy saved route). Unknown signals are omitted
  // from the reasons rather than shown as a fabricated value.
  intersections_per_km: number | null;
  sidewalk_coverage: number | null;
};

export type Reason = {
  /** Semantic key the UI maps to an icon. */
  key: "flat" | "hilly" | "quiet" | "busy" | "sidewalks" | "distance";
  text: string;
};

export type GradeMeta = {
  label: string;
  blurb: string;
  /** Tailwind gradient stops used for the animated grade badge. */
  from: string;
  to: string;
  /** Hex pair used by the canvas image renderer (no Tailwind at draw time). */
  hexFrom: string;
  hexTo: string;
};

// An ordered scale, not decoration: the hue carries the grade, so it stays a
// monotonic green -> amber -> red ramp.
//
// This ramp is deliberately NOT tied to the brand accent. It used to be — grade
// A was the accent lime, so "best grade" and "primary action" were one colour —
// but the accent is now the logo's cyan, and cyan does not read as "good" on a
// good-to-bad scale the way green does. Grades are a semantic scale first and
// branding second, so the ramp keeps its meaning and the accent goes its own
// way. Changing A to cyan would break the warmth progression that makes the
// scale legible without reading the letter.
export const GRADE_META: Record<Grade, GradeMeta> = {
  A: {
    label: "Excellent run",
    blurb: "A top-tier route worth coming back to.",
    from: "from-[#d8ff3e]",
    to: "to-[#a3e635]",
    hexFrom: "#d8ff3e",
    hexTo: "#a3e635",
  },
  B: {
    label: "Good run",
    blurb: "A solid, enjoyable route.",
    from: "from-[#a3e635]",
    to: "to-[#84cc16]",
    hexFrom: "#a3e635",
    hexTo: "#84cc16",
  },
  C: {
    label: "Fair run",
    blurb: "Gets the job done, with some trade-offs.",
    from: "from-[#fbbf24]",
    to: "to-[#f59e0b]",
    hexFrom: "#fbbf24",
    hexTo: "#f59e0b",
  },
  D: {
    label: "Rough run",
    blurb: "Better options are probably nearby.",
    from: "from-[#fb7185]",
    to: "to-[#f97316]",
    hexFrom: "#fb7185",
    hexTo: "#f97316",
  },
};

/**
 * Plain-language reasons behind the grade, most distinctive first. Derived
 * only from measured signals; unknown signals are skipped.
 */
export function deriveReasons(route: ScorecardRoute): Reason[] {
  const reasons: Reason[] = [];

  const gainRate =
    route.distance_km > 0 ? route.elevation_gain_m / route.distance_km : 0;
  if (gainRate <= 8) {
    reasons.push({ key: "flat", text: "Flat and fast" });
  } else if (gainRate <= 16) {
    reasons.push({ key: "hilly", text: "Gently rolling" });
  } else {
    reasons.push({ key: "hilly", text: "A proper climb" });
  }

  // Intersection density is omitted entirely when unknown (null) — never
  // shown as "few crossings" off a missing/defaulted value.
  const crossings = route.intersections_per_km;
  if (crossings !== null) {
    if (crossings <= 3) {
      reasons.push({ key: "quiet", text: "Quiet — few crossings" });
    } else if (crossings <= 7) {
      reasons.push({ key: "busy", text: "A few street crossings" });
    } else {
      reasons.push({ key: "busy", text: "Busy with crossings" });
    }
  }

  // Sidewalk coverage is unknown in scoring v1 — only speak to it when we have
  // a real measurement, never guess.
  if (route.sidewalk_coverage !== null) {
    if (route.sidewalk_coverage >= 0.7) {
      reasons.push({ key: "sidewalks", text: "Great sidewalk coverage" });
    } else if (route.sidewalk_coverage <= 0.3) {
      reasons.push({ key: "sidewalks", text: "Sparse sidewalks" });
    }
  }

  reasons.push({
    key: "distance",
    text: `${route.distance_km.toFixed(1)} km loop`,
  });

  return reasons;
}

/** Text shared into a chat/social — grade + reasons, never any location. */
export function buildShareText(route: ScorecardRoute): string {
  const reasons = deriveReasons(route)
    .map((r) => r.text.toLowerCase())
    .join(", ");
  return (
    `Graded ${route.grade} (${route.score.toFixed(0)}/100) on RouteGrade — ` +
    `${reasons}.`
  );
}

/** Catalog of the quick-tap rating tags. Slugs must match the API allow-list. */
export const RATING_TAGS: { slug: string; label: string; positive: boolean }[] = [
  { slug: "flat", label: "Flat", positive: true },
  { slug: "hilly", label: "Hilly", positive: false },
  { slug: "quiet", label: "Quiet", positive: true },
  { slug: "busy", label: "Busy", positive: false },
  { slug: "scenic", label: "Scenic", positive: true },
  { slug: "great_views", label: "Great views", positive: true },
  { slug: "well_lit", label: "Well-lit", positive: true },
  { slug: "poorly_lit", label: "Poorly lit", positive: false },
  { slug: "good_surface", label: "Good surface", positive: true },
  { slug: "bad_surface", label: "Bad surface", positive: false },
  { slug: "felt_safe", label: "Felt safe", positive: true },
  { slug: "felt_unsafe", label: "Felt unsafe", positive: false },
  { slug: "too_many_crossings", label: "Too many crossings", positive: false },
  { slug: "got_lost", label: "Got lost", positive: false },
];
