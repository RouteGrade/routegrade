import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FEEDBACK,
  FEEDBACK_TAGS,
  isSubmittable,
  MAX_TAGS,
  reconcileTags,
  tagsForVerdict,
  toggleTag,
  VERDICTS,
  type FeedbackDraft,
} from "./route-feedback";

describe("route feedback · vocabulary stays in sync with the server", () => {
  it("uses only slugs the API's ALLOWED_TAGS accepts", () => {
    // The server validates against a closed allow-list and 422s anything else,
    // so a typo here would fail at submit time for a real runner rather than
    // in CI. Read the Python source and compare, so the two cannot drift.
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../../../../services/api/app/schemas/route_feedback.py",
      ),
      "utf8",
    );
    const block = source.split("ALLOWED_TAGS")[1]?.split(")")[0] ?? "";
    const serverTags = new Set(
      Array.from(block.matchAll(/"([a-z_]+)"/g), (m) => m[1]),
    );

    expect(serverTags.size).toBeGreaterThan(0);
    for (const tag of FEEDBACK_TAGS) {
      expect(serverTags.has(tag.slug), `${tag.slug} missing server-side`).toBe(true);
    }
  });

  it("offers every server tag somewhere in the UI", () => {
    // The reverse direction: a tag the server accepts but we never show is
    // signal the calibration loop silently never receives.
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../../../../services/api/app/schemas/route_feedback.py",
      ),
      "utf8",
    );
    const block = source.split("ALLOWED_TAGS")[1]?.split(")")[0] ?? "";
    const serverTags = Array.from(block.matchAll(/"([a-z_]+)"/g), (m) => m[1]);
    const ours = new Set(FEEDBACK_TAGS.map((t) => t.slug));

    for (const slug of serverTags) {
      expect(ours.has(slug), `${slug} accepted by API but never offered`).toBe(true);
    }
  });

  it("never exceeds the server's tag cap by construction", () => {
    for (const verdict of VERDICTS) {
      expect(tagsForVerdict(verdict.value).length).toBeLessThanOrEqual(MAX_TAGS);
    }
  });
});

describe("tagsForVerdict", () => {
  it("only offers reasons that can justify the verdict", () => {
    const generous = tagsForVerdict("too_generous").map((t) => t.slug);
    expect(generous).toContain("hillier_than_graded");
    // The opposite claim must not be offered under this verdict.
    expect(generous).not.toContain("flatter_than_graded");

    const harsh = tagsForVerdict("too_harsh").map((t) => t.slug);
    expect(harsh).toContain("flatter_than_graded");
    expect(harsh).not.toContain("hillier_than_graded");
  });

  it("offers distance under every verdict, since it is orthogonal to the grade", () => {
    for (const verdict of VERDICTS) {
      expect(tagsForVerdict(verdict.value).map((t) => t.slug)).toContain("distance_off");
    }
  });
});

describe("toggleTag", () => {
  const base: FeedbackDraft = { ...EMPTY_FEEDBACK, verdict: "too_generous" };

  it("adds then removes a tag", () => {
    const on = toggleTag(base, "hillier_than_graded");
    expect(on.tags).toEqual(["hillier_than_graded"]);
    expect(toggleTag(on, "hillier_than_graded").tags).toEqual([]);
  });

  it("refuses to exceed the cap, and says so by returning an unchanged draft", () => {
    const full: FeedbackDraft = {
      ...base,
      tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`),
    };
    const after = toggleTag(full, "one_too_many");
    expect(after.tags).toHaveLength(MAX_TAGS);
    expect(after.tags).toEqual(full.tags);
  });

  it("still removes a tag when already at the cap", () => {
    const full: FeedbackDraft = {
      ...base,
      tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`),
    };
    expect(toggleTag(full, "t0").tags).toHaveLength(MAX_TAGS - 1);
  });
});

describe("reconcileTags", () => {
  it("drops reasons that contradict the newly chosen verdict", () => {
    // Without this, a runner who picks "too generous", tags "hillier than
    // graded", then switches to "too harsh" would submit a reason arguing the
    // opposite of their own verdict.
    const draft: FeedbackDraft = {
      verdict: "too_generous",
      tags: ["hillier_than_graded", "distance_off"],
      comment: "",
    };
    const switched = reconcileTags(draft, "too_harsh");
    expect(switched.verdict).toBe("too_harsh");
    expect(switched.tags).toEqual(["distance_off"]);
  });

  it("keeps the note across a verdict change", () => {
    const draft: FeedbackDraft = {
      verdict: "too_generous",
      tags: [],
      comment: "steep from the bridge onward",
    };
    expect(reconcileTags(draft, "accurate").comment).toBe("steep from the bridge onward");
  });
});

describe("isSubmittable", () => {
  it("requires a verdict and nothing else", () => {
    expect(isSubmittable(EMPTY_FEEDBACK)).toBe(false);
    expect(isSubmittable({ ...EMPTY_FEEDBACK, tags: ["distance_off"] })).toBe(false);
    expect(isSubmittable({ ...EMPTY_FEEDBACK, verdict: "accurate" })).toBe(true);
  });
});
