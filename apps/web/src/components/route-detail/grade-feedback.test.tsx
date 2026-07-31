// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/authenticated-client";

/**
 * Rendering coverage for the grade-feedback block — flagged as missing when it
 * shipped in #45.
 *
 * `lib/route-feedback.ts` already covers the vocabulary and the draft rules, so
 * these test the wiring: that a verdict gates submission, that switching a
 * verdict cannot strand a contradictory reason, and that what reaches the API
 * is what the runner actually chose.
 */

const { getRouteFeedback, saveRouteFeedback } = vi.hoisted(() => ({
  getRouteFeedback: vi.fn(),
  saveRouteFeedback: vi.fn(),
}));

vi.mock("@/lib/api/route-feedback-client", () => ({
  getRouteFeedback,
  saveRouteFeedback,
}));

const { GradeFeedback } = await import("./grade-feedback");

const PROPS = {
  routeId: "route-1",
  gradedScore: 82,
  gradedGrade: "B" as const,
  preference: null,
};

const verdict = (name: string) =>
  within(screen.getByRole("group", { name: "Grade verdict" })).getByRole("button", {
    name: new RegExp(name, "i"),
  });

beforeEach(() => {
  getRouteFeedback.mockReset();
  saveRouteFeedback.mockReset();
  getRouteFeedback.mockResolvedValue(null);
  saveRouteFeedback.mockResolvedValue({ feedback: {}, created: true });
});

afterEach(cleanup);

describe("GradeFeedback · gating", () => {
  it("offers no submit until a verdict is chosen", async () => {
    render(<GradeFeedback {...PROPS} />);

    await screen.findByRole("group", { name: "Grade verdict" });
    // A verdict is the whole requirement, so nothing to send before one exists.
    expect(screen.queryByRole("button", { name: /send feedback/i })).toBeNull();

    fireEvent.click(verdict("About right"));
    expect(screen.getByRole("button", { name: /send feedback/i })).toBeTruthy();
  });

  it("marks the chosen verdict as pressed, and only that one", async () => {
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("Too generous"));
    expect(verdict("Too generous").getAttribute("aria-pressed")).toBe("true");
    expect(verdict("About right").getAttribute("aria-pressed")).toBe("false");
    expect(verdict("Too harsh").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("GradeFeedback · reasons follow the verdict", () => {
  it("only offers reasons that can justify the chosen verdict", async () => {
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("Too generous"));
    expect(screen.getByRole("button", { name: "Hillier than graded" })).toBeTruthy();
    // The opposite claim must not be offerable under this verdict.
    expect(screen.queryByRole("button", { name: "Flatter than graded" })).toBeNull();
  });

  it("drops a reason that contradicts a newly chosen verdict", async () => {
    // THE CASE THAT MATTERS. Picking "too generous", tagging "hillier", then
    // switching to "too harsh" must not submit a reason arguing the opposite
    // of the verdict — that is the one thing calibration data cannot contain.
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("Too generous"));
    fireEvent.click(screen.getByRole("button", { name: "Hillier than graded" }));
    expect(
      screen.getByRole("button", { name: "Hillier than graded" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(verdict("Too harsh"));
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(saveRouteFeedback).toHaveBeenCalled());
    const [, payload] = saveRouteFeedback.mock.calls[0];
    expect(payload.verdict).toBe("too_harsh");
    expect(payload.tags).not.toContain("hillier_than_graded");
  });
});

describe("GradeFeedback · what reaches the API", () => {
  it("sends the verdict, tags and the prediction snapshot", async () => {
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("Too generous"));
    fireEvent.click(screen.getByRole("button", { name: "Hillier than graded" }));
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(saveRouteFeedback).toHaveBeenCalledWith("route-1", {
      verdict: "too_generous",
      tags: ["hillier_than_graded"],
      comment: null,
      graded_score: 82,
      graded_grade: "B",
      preference: null,
    }));
  });

  it("sends a blank note as null rather than an empty string", async () => {
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("About right"));
    fireEvent.change(screen.getByLabelText(/anything else/i), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(saveRouteFeedback).toHaveBeenCalled());
    expect(saveRouteFeedback.mock.calls[0][1].comment).toBeNull();
  });

  it("confirms once sent, and stops offering to send again", async () => {
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("About right"));
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    const done = await screen.findByRole("button", { name: /thanks/i });
    expect(done.hasAttribute("disabled")).toBe(true);
  });
});

describe("GradeFeedback · existing feedback and failures", () => {
  it("pre-fills a verdict the runner already gave", async () => {
    getRouteFeedback.mockResolvedValue({
      verdict: "too_harsh",
      tags: ["flatter_than_graded"],
      comment: "downhill the whole way",
    });
    render(<GradeFeedback {...PROPS} />);

    await waitFor(() =>
      expect(verdict("Too harsh").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByDisplayValue("downhill the whole way")).toBeTruthy();
    expect(screen.getByRole("button", { name: /thanks/i })).toBeTruthy();
  });

  it("still lets the runner rate when the existing-feedback read fails", async () => {
    // The PUT is an upsert, so a failed GET is not worth blocking on — it must
    // not leave the block unusable.
    getRouteFeedback.mockRejectedValue(new ApiError(500, "boom"));
    render(<GradeFeedback {...PROPS} />);

    await screen.findByRole("group", { name: "Grade verdict" });
    fireEvent.click(verdict("About right"));
    expect(screen.getByRole("button", { name: /send feedback/i })).toBeTruthy();
  });

  it("distinguishes an expired session from a send failure", async () => {
    saveRouteFeedback.mockRejectedValue(new ApiError(401, "no session"));
    render(<GradeFeedback {...PROPS} />);
    await screen.findByRole("group", { name: "Grade verdict" });

    fireEvent.click(verdict("About right"));
    fireEvent.click(screen.getByRole("button", { name: /send feedback/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/session expired/i);
  });
});
