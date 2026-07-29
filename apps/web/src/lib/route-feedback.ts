/**
 * Grade feedback on a saved route — "was this grade right?"
 *
 * Separate from the post-run rating in `run-rating.tsx`, which asks how the RUN
 * felt. This asks whether the GRADE we predicted matched the road, which is the
 * signal the scoring calibration loop needs. A runner can love a route and
 * still think we graded it wrong.
 *
 * The tag vocabulary is a closed list mirroring `ALLOWED_TAGS` in
 * `services/api/app/schemas/route_feedback.py`. The server rejects anything
 * outside it, so drift here becomes a 422 rather than a silent no-op —
 * `route-feedback.test.ts` pins the two lists together.
 */

export type Verdict = "accurate" | "too_generous" | "too_harsh";

export const VERDICTS: {
  value: Verdict;
  label: string;
  /** What the runner is actually claiming, in their words not ours. */
  hint: string;
}[] = [
  { value: "accurate", label: "About right", hint: "The grade matched the run" },
  { value: "too_generous", label: "Too generous", hint: "Worse than we graded it" },
  { value: "too_harsh", label: "Too harsh", hint: "Better than we graded it" },
];

/** Server cap; a longer note is a 422, so the textarea stops here too. */
export const MAX_COMMENT = 280;
/** Server cap on how many reasons may accompany one verdict. */
export const MAX_TAGS = 6;

export type FeedbackTag = {
  slug: string;
  label: string;
  /** Which verdicts this reason makes sense alongside. */
  verdicts: Verdict[];
};

/**
 * Reasons a grade felt wrong, paired to the verdict they explain.
 *
 * Each is offered only under the verdict it can actually justify — "hillier
 * than graded" is a reason we were too generous, never that we were too harsh.
 * Showing all eleven under every verdict would invite contradictory pairs into
 * the calibration data.
 */
export const FEEDBACK_TAGS: FeedbackTag[] = [
  { slug: "too_many_crossings", label: "Too many crossings", verdicts: ["too_generous"] },
  { slug: "hillier_than_graded", label: "Hillier than graded", verdicts: ["too_generous"] },
  { slug: "busier_than_graded", label: "Busier than graded", verdicts: ["too_generous"] },
  { slug: "surface_worse", label: "Rougher surface", verdicts: ["too_generous"] },
  { slug: "not_scenic", label: "Not scenic", verdicts: ["too_generous"] },
  { slug: "too_few_crossings", label: "Fewer crossings", verdicts: ["too_harsh"] },
  { slug: "flatter_than_graded", label: "Flatter than graded", verdicts: ["too_harsh"] },
  { slug: "quieter_than_graded", label: "Quieter than graded", verdicts: ["too_harsh"] },
  { slug: "surface_better", label: "Better surface", verdicts: ["too_harsh"] },
  { slug: "more_scenic", label: "More scenic", verdicts: ["too_harsh"] },
  // Distance being wrong is orthogonal to the grade being generous or harsh,
  // so it is offered under every verdict including "about right".
  {
    slug: "distance_off",
    label: "Distance was off",
    verdicts: ["accurate", "too_generous", "too_harsh"],
  },
];

export function tagsForVerdict(verdict: Verdict): FeedbackTag[] {
  return FEEDBACK_TAGS.filter((tag) => tag.verdicts.includes(verdict));
}

export type FeedbackDraft = {
  verdict: Verdict | null;
  tags: string[];
  comment: string;
};

export const EMPTY_FEEDBACK: FeedbackDraft = { verdict: null, tags: [], comment: "" };

/** Only a verdict is required; tags and the note are both optional. */
export function isSubmittable(draft: FeedbackDraft): boolean {
  return draft.verdict !== null;
}

/**
 * Toggle a reason on or off, refusing to exceed the server's cap.
 *
 * Silently dropping the 7th tap would look broken, so the caller can tell the
 * difference: an unchanged array back means the cap was hit.
 */
export function toggleTag(draft: FeedbackDraft, slug: string): FeedbackDraft {
  if (draft.tags.includes(slug)) {
    return { ...draft, tags: draft.tags.filter((t) => t !== slug) };
  }
  if (draft.tags.length >= MAX_TAGS) return draft;
  return { ...draft, tags: [...draft.tags, slug] };
}

/**
 * Drop tags that no longer make sense after the verdict changes.
 *
 * Without this, picking "too generous", tagging "hillier than graded", then
 * switching to "too harsh" would submit a reason that contradicts the verdict.
 */
export function reconcileTags(draft: FeedbackDraft, verdict: Verdict): FeedbackDraft {
  const allowed = new Set(tagsForVerdict(verdict).map((t) => t.slug));
  return { ...draft, verdict, tags: draft.tags.filter((t) => allowed.has(t)) };
}
