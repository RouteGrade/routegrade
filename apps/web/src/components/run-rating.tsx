"use client";

import type { GradeMatch } from "@/lib/api/run-ratings-client";
import { RATING_TAGS } from "@/lib/scorecard";

/** The in-progress rating a runner is filling in on the summary screen. */
export type RatingDraft = {
  /** 1-5; 0 means "not rated yet". */
  overall: number;
  gradeMatch: GradeMatch | null;
  tags: string[];
};

export const EMPTY_RATING: RatingDraft = { overall: 0, gradeMatch: null, tags: [] };

/** True once the runner has done the one thing that makes a rating worth saving. */
export function hasRating(draft: RatingDraft): boolean {
  return draft.overall > 0;
}

const GRADE_MATCH_OPTIONS: { value: GradeMatch; label: string }[] = [
  { value: "felt_better", label: "Better than graded" },
  { value: "as_expected", label: "Spot on" },
  { value: "felt_worse", label: "Worse than graded" },
];

function StarButton({
  index,
  filled,
  onSelect,
  disabled,
}: {
  index: number;
  filled: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`${index} star${index === 1 ? "" : "s"}`}
      aria-pressed={filled}
      className="p-0.5 transition active:scale-90 disabled:opacity-60"
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-8 w-8 transition-colors ${
          filled ? "text-amber-400" : "text-zinc-600"
        }`}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      >
        <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.9l-5.8 3.06 1.1-6.47L2.6 9.9l6.5-.95L12 2.5Z" />
      </svg>
    </button>
  );
}

export function RunRating({
  value,
  onChange,
  disabled = false,
}: {
  value: RatingDraft;
  onChange: (next: RatingDraft) => void;
  disabled?: boolean;
}) {
  const toggleTag = (slug: string) => {
    const tags = value.tags.includes(slug)
      ? value.tags.filter((t) => t !== slug)
      : [...value.tags, slug];
    onChange({ ...value, tags });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-center text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        How was this route?
      </p>

      <div className="mt-2 flex items-center justify-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <StarButton
            key={n}
            index={n}
            filled={n <= value.overall}
            disabled={disabled}
            onSelect={() => onChange({ ...value, overall: n })}
          />
        ))}
      </div>

      {value.overall > 0 && (
        <div className="animate-float-in mt-4 flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-center text-[10px] uppercase tracking-wider text-zinc-500">
              Did our grade match?
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {GRADE_MATCH_OPTIONS.map((option) => {
                const selected = value.gradeMatch === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() =>
                      onChange({
                        ...value,
                        gradeMatch: selected ? null : option.value,
                      })
                    }
                    className={`rounded-lg border px-1.5 py-2 text-[11px] font-semibold leading-tight transition ${
                      selected
                        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                        : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-center text-[10px] uppercase tracking-wider text-zinc-500">
              Add a few tags (optional)
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {RATING_TAGS.map((tag) => {
                const selected = value.tags.includes(tag.slug);
                return (
                  <button
                    key={tag.slug}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => toggleTag(tag.slug)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      selected
                        ? tag.positive
                          ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                          : "border-amber-400/50 bg-amber-400/15 text-amber-300"
                        : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
