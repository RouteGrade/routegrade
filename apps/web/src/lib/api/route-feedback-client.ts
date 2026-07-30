"use client";

import { ApiError, request } from "@/lib/api/authenticated-client";
import type { Preference } from "@/lib/api/routes-client";
import type { Verdict } from "@/lib/route-feedback";
import type { Grade } from "@/lib/scorecard";

export type RouteFeedback = {
  id: string;
  route_id: string;
  verdict: Verdict;
  tags: string[];
  comment: string | null;
  graded_score: number | null;
  graded_grade: Grade | null;
  preference: Preference | null;
  created_at: string;
  updated_at: string;
};

export type SaveRouteFeedbackPayload = {
  verdict: Verdict;
  tags: string[];
  comment: string | null;
  /**
   * Snapshot of what we predicted at the moment of rating. Sent by the client
   * so calibration compares felt-vs-predicted without re-deriving a grade that
   * may since have changed.
   */
  graded_score: number | null;
  graded_grade: Grade | null;
  preference: Preference | null;
};

/** Existing feedback for a route, or null when the runner hasn't rated it. */
export async function getRouteFeedback(routeId: string): Promise<RouteFeedback | null> {
  try {
    return await request<RouteFeedback>(`/v1/users/me/routes/${routeId}/feedback`);
  } catch (err) {
    // 404 is the ordinary "not rated yet" answer, not a failure worth showing.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveRouteFeedback(
  routeId: string,
  payload: SaveRouteFeedbackPayload,
): Promise<{ feedback: RouteFeedback; created: boolean }> {
  return request<{ feedback: RouteFeedback; created: boolean }>(
    `/v1/users/me/routes/${routeId}/feedback`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}

export async function deleteRouteFeedback(routeId: string): Promise<void> {
  await request<void>(`/v1/users/me/routes/${routeId}/feedback`, { method: "DELETE" });
}
