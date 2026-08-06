"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/authenticated-client";
import {
  getRouteFeedback,
  saveRouteFeedback,
} from "@/lib/api/route-feedback-client";
import type { Preference } from "@/lib/api/routes-client";
import {
  EMPTY_FEEDBACK,
  MAX_COMMENT,
  MAX_TAGS,
  reconcileTags,
  tagsForVerdict,
  toggleTag,
  VERDICTS,
  type FeedbackDraft,
  type Verdict,
} from "@/lib/route-feedback";
import type { Grade } from "@/lib/scorecard";

/**
 * "Was this grade right?" on a saved route.
 *
 * The one signal the scoring calibration loop actually needs, and the only
 * place a runner can tell us our grade was wrong. Deliberately one tap to
 * answer: a verdict is the whole requirement, and the reason tags and note are
 * optional extras for anyone who wants to say more.
 *
 * Only rendered for SAVED routes: the endpoint keys on a saved-route id the
 * user owns, so offering it on an unsaved plan would 404 on submit.
 */
export function GradeFeedback({
  routeId,
  gradedScore,
  gradedGrade,
  preference,
}: {
  routeId: string;
  gradedScore: number | null;
  gradedGrade: Grade | null;
  preference: Preference | null;
}) {
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_FEEDBACK);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capHit, setCapHit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRouteFeedback(routeId)
      .then((existing) => {
        if (cancelled || !existing) return;
        setDraft({
          verdict: existing.verdict,
          tags: existing.tags,
          comment: existing.comment ?? "",
        });
        setSaved(true);
      })
      // A failed read is not worth interrupting the route view for — the
      // runner can still submit, and the PUT is an upsert either way.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  function chooseVerdict(verdict: Verdict) {
    setCapHit(false);
    setSaved(false);
    setDraft((d) => reconcileTags(d, verdict));
  }

  function onToggleTag(slug: string) {
    setSaved(false);
    setDraft((d) => {
      const next = toggleTag(d, slug);
      // An unchanged array back means the cap refused the tap; say so rather
      // than letting the button look broken.
      setCapHit(next.tags === d.tags);
      return next;
    });
  }

  async function submit() {
    if (draft.verdict === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveRouteFeedback(routeId, {
        verdict: draft.verdict,
        tags: draft.tags,
        comment: draft.comment.trim() || null,
        graded_score: gradedScore,
        graded_grade: gradedGrade,
        preference,
      });
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Your session expired. Please sign in again."
          : "Couldn't send that. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const available = draft.verdict ? tagsForVerdict(draft.verdict) : [];

  return (
    <section aria-label="Grade feedback" className="mt-6 border-t border-hairline pt-5">
      <h3 className="rg-label mb-1">Was this grade right?</h3>
      <p className="mb-3 text-xs text-muted">
        Tells us where our grading is off. Only you can see it.
      </p>

      <div role="group" aria-label="Grade verdict" className="flex flex-col gap-2">
        {VERDICTS.map((option) => {
          const active = draft.verdict === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => chooseVerdict(option.value)}
              className={`flex items-center justify-between rounded-control border px-4 py-3 text-left transition-colors ${
                active
                  ? "border-accent bg-accent-wash"
                  : "border-hairline hover:border-hairline-strong"
              }`}
            >
              <span className="text-sm font-semibold text-ink">{option.label}</span>
              <span className="ml-3 text-xs text-muted">{option.hint}</span>
            </button>
          );
        })}
      </div>

      {draft.verdict && (
        <>
          <p className="rg-label mt-5 mb-2">Why? (optional)</p>
          <ul className="flex flex-wrap gap-2">
            {available.map((tag) => {
              const on = draft.tags.includes(tag.slug);
              return (
                <li key={tag.slug}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleTag(tag.slug)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      on
                        ? "border-accent bg-accent-wash text-ink"
                        : "border-hairline text-muted hover:border-hairline-strong"
                    }`}
                  >
                    {tag.label}
                  </button>
                </li>
              );
            })}
          </ul>
          {capHit && (
            <p role="status" className="mt-2 text-xs text-muted">
              That&apos;s the most reasons we can send ({MAX_TAGS}).
            </p>
          )}

          <label htmlFor="feedback-note" className="rg-label mt-5 mb-2 block">
            Anything else? (optional)
          </label>
          <textarea
            id="feedback-note"
            rows={2}
            maxLength={MAX_COMMENT}
            value={draft.comment}
            onChange={(e) => {
              setSaved(false);
              setDraft((d) => ({ ...d, comment: e.target.value }));
            }}
            className="w-full rounded-control border border-hairline bg-canvas px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-accent"
            placeholder="e.g. the last kilometre is all uphill"
          />

          <button
            type="button"
            onClick={submit}
            disabled={saving || saved}
            className={`rg-btn mt-3 w-full ${saved ? "border border-accent/40 bg-accent-wash text-accent" : "rg-btn-primary"}`}
          >
            {saved ? "Thanks — noted" : saving ? "Sending…" : "Send feedback"}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-center text-xs text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
