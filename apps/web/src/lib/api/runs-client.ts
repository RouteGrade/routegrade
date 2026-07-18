"use client";

import { request } from "@/lib/api/authenticated-client";
import type { LineStringGeometry } from "@/lib/api/routes-client";

export type RunSplit = {
  km: number;
  duration_s: number;
};

export type RecordedRun = {
  id: string;
  route_id: string | null;
  route_name: string | null;
  started_at: string;
  duration_s: number;
  distance_km: number;
  avg_pace_s_per_km: number | null;
  splits: RunSplit[];
  path: LineStringGeometry | null;
  created_at: string;
  updated_at: string;
};

export type SaveRunPayload = Omit<RecordedRun, "id" | "created_at" | "updated_at">;

export async function listRuns(): Promise<RecordedRun[]> {
  const { runs } = await request<{ runs: RecordedRun[] }>("/v1/users/me/runs");
  return runs;
}

export async function saveRun(
  id: string,
  payload: SaveRunPayload,
): Promise<{ run: RecordedRun; created: boolean }> {
  return request<{ run: RecordedRun; created: boolean }>(`/v1/users/me/runs/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteRun(id: string): Promise<void> {
  await request<void>(`/v1/users/me/runs/${id}`, { method: "DELETE" });
}
