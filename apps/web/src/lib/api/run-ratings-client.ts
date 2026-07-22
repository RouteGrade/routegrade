"use client";

import { request } from "@/lib/api/authenticated-client";
import type { Preference } from "@/lib/api/routes-client";

/** How the run felt versus the grade we gave the route. */
export type GradeMatch = "felt_better" | "as_expected" | "felt_worse";

export type RunRating = {
  id: string;
  run_id: string;
  route_id: string | null;
  overall: number;
  grade_match: GradeMatch | null;
  tags: string[];
  comment: string | null;
  graded_score: number | null;
  graded_grade: "A" | "B" | "C" | "D" | null;
  preference: Preference | null;
  created_at: string;
  updated_at: string;
};

export type SaveRunRatingPayload = {
  overall: number;
  grade_match?: GradeMatch | null;
  tags?: string[];
  comment?: string | null;
  route_id?: string | null;
  graded_score?: number | null;
  graded_grade?: "A" | "B" | "C" | "D" | null;
  preference?: Preference | null;
};

export async function getRunRating(runId: string): Promise<RunRating> {
  return request<RunRating>(`/v1/users/me/runs/${runId}/rating`);
}

export async function saveRunRating(
  runId: string,
  payload: SaveRunRatingPayload,
): Promise<{ rating: RunRating; created: boolean }> {
  return request<{ rating: RunRating; created: boolean }>(
    `/v1/users/me/runs/${runId}/rating`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}
