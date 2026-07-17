"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type UserProfile = {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: string;
  created_at: string;
  updated_at: string;
};

export type ProvisionResult = {
  user: UserProfile;
  created: boolean;
};

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getAccessToken(): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new ApiError(401, "No active session");
  }
  return session.access_token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail?.message) detail = body.detail.message;
      else if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // ignore body parse
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export async function provisionCurrentUser(): Promise<ProvisionResult> {
  return request<ProvisionResult>("/v1/users/me", { method: "PUT" });
}

export async function fetchCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>("/v1/users/me", { method: "GET" });
}

export async function updateDisplayName(displayName: string): Promise<UserProfile> {
  return request<UserProfile>("/v1/users/me", {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}

export { ApiError };
