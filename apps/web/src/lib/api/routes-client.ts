"use client";

import { API_BASE, ApiError, request } from "@/lib/api/authenticated-client";

export type Preference = "quiet" | "flat" | "scenic";

export type LineStringGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

export type PlannedRoute = {
  id: string;
  name: string;
  geometry: LineStringGeometry;
  distance_km: number;
  elevation_gain_m: number;
  // null when the metric is unknown — e.g. a legacy saved route reopened
  // before intersection density was persisted.
  intersections_per_km: number | null;
  sidewalk_coverage: number | null;
  score: number;
  grade: "A" | "B" | "C" | "D";
  // null when unknown — e.g. a reopened saved route, which doesn't persist
  // sub-scores server-side (only the final grade/score).
  elevation_subscore: number | null;
  intersection_subscore: number | null;
  within_tolerance: boolean;
  provider: string;
};

export type PlanResponse = {
  start: { latitude: number; longitude: number; label: string };
  requested_distance_km: number;
  preference: Preference;
  distance_tolerance: number;
  routes: PlannedRoute[];
};

export type PlanRequest = {
  address?: string;
  latitude?: number;
  longitude?: number;
  distance_km: number;
  preference: Preference;
};

export type SavedRoute = {
  id: string;
  name: string;
  starting_address: string | null;
  distance_km: number;
  preference: Preference;
  geometry: LineStringGeometry;
  elevation_gain_m: number;
  // null for legacy routes saved before intersection density was persisted.
  intersections_per_km: number | null;
  score: number;
  grade: "A" | "B" | "C" | "D";
  created_at: string;
  updated_at: string;
};

export type SaveRoutePayload = Omit<SavedRoute, "id" | "created_at" | "updated_at">;

/** Public — no auth token attached, matching MVP 1's open route experience. */
export async function planRoute(body: PlanRequest): Promise<PlanResponse> {
  const res = await fetch(`${API_BASE}/v1/routes/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail?.message) detail = payload.detail.message;
      else if (typeof payload?.detail === "string") detail = payload.detail;
    } catch {
      // ignore body parse
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as PlanResponse;
}

export type CustomRouteRequest = {
  coordinates: [number, number][];
  preference: Preference;
  name?: string;
};

/**
 * Grade a user-drawn route. Public like planRoute — the server snaps the raw
 * trace to the road network and scores it, returning one PlannedRoute.
 */
export async function gradeCustomRoute(
  body: CustomRouteRequest,
): Promise<PlannedRoute> {
  const res = await fetch(`${API_BASE}/v1/routes/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail?.message) detail = payload.detail.message;
      else if (typeof payload?.detail === "string") detail = payload.detail;
    } catch {
      // ignore body parse
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as PlannedRoute;
}

export type SnapRouteResponse = {
  geometry: LineStringGeometry;
  distance_km: number;
};

/**
 * Snap a drawn trace onto roads (geometry only, no grade). Fast enough to call
 * repeatedly while the user draws, for live assisted snapping.
 */
export async function snapRoute(
  coordinates: [number, number][],
): Promise<SnapRouteResponse> {
  const res = await fetch(`${API_BASE}/v1/routes/snap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.detail?.message) detail = payload.detail.message;
      else if (typeof payload?.detail === "string") detail = payload.detail;
    } catch {
      // ignore body parse
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as SnapRouteResponse;
}

export async function listSavedRoutes(): Promise<SavedRoute[]> {
  const { routes } = await request<{ routes: SavedRoute[] }>("/v1/users/me/routes");
  return routes;
}

export async function getSavedRoute(id: string): Promise<SavedRoute> {
  return request<SavedRoute>(`/v1/users/me/routes/${id}`);
}

export async function saveRoute(
  id: string,
  payload: SaveRoutePayload,
): Promise<{ route: SavedRoute; created: boolean }> {
  return request<{ route: SavedRoute; created: boolean }>(`/v1/users/me/routes/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteSavedRoute(id: string): Promise<void> {
  await request<void>(`/v1/users/me/routes/${id}`, { method: "DELETE" });
}
