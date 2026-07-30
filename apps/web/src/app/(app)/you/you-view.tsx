"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { BrandLoader } from "@/components/brand/brand-loader";
import {
  ApiError,
  provisionCurrentUser,
  updateDisplayName,
  type UserProfile,
} from "@/lib/api/authenticated-client";
import { RunnerStats } from "./runner-stats";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; profile: UserProfile }
  | { kind: "error"; message: string };

export function YouView() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState("");

  const provision = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      // PUT is idempotent — safe to call on every mount. Handles both
      // first-time provisioning and returning-user refresh.
      const { user } = await provisionCurrentUser();
      if (signal?.cancelled) return;
      setState({ kind: "ready", profile: user });
      setDraftName(user.display_name ?? "");
    } catch (err) {
      if (signal?.cancelled) return;
      const message =
        err instanceof ApiError && err.status === 401
          ? "Your session expired. Please sign in again."
          : "We couldn't reach RouteGrade. Please try again.";
      setState({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    // On-mount side effect: kick off provisioning against FastAPI. State
    // transitions from "loading" -> "ready"|"error" after the network round
    // trip; the initial render is already "loading", so no synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    provision(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [provision]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    provision();
  }, [provision]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || state.kind !== "ready") return;
    const trimmed = draftName.trim();
    if (!trimmed) {
      setSaveError("Display name cannot be empty.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateDisplayName(trimmed);
      setState({ kind: "ready", profile: updated });
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Could not save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") {
    return <BrandLoader label="Loading your profile" />;
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-card border border-danger/30 bg-danger-wash p-5">
        <p className="text-sm text-ink">{state.message}</p>
        <button
          type="button"
          onClick={retry}
          className="rg-btn rg-btn-secondary mt-4"
        >
          Try again
        </button>
      </div>
    );
  }

  const { profile } = state;

  return (
    <>
      <div className="flex items-center gap-4">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="rg-display flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl text-canvas"
          >
            {(profile.display_name ?? profile.email).slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">
            {profile.display_name ?? "Runner"}
          </p>
          <p className="truncate text-sm text-muted">{profile.email}</p>
        </div>
      </div>

      <RunnerStats />

      <section aria-label="Settings" className="mt-8">
        <h2 className="rg-label mb-3">Settings</h2>
        <form onSubmit={onSave} className="flex flex-col gap-3">
          <label htmlFor="display_name" className="rg-label">
            Display name
          </label>
          <input
            id="display_name"
            type="text"
            maxLength={80}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            className="h-13 rounded-control border border-hairline bg-surface px-4 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-accent"
          />
          <button
            type="submit"
            disabled={saving}
            className="rg-btn rg-btn-primary"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveError && (
            <p role="alert" className="text-xs text-danger">
              {saveError}
            </p>
          )}
        </form>
      </section>

      <div className="mt-10 border-t border-hairline pt-6">
        <p className="rg-label">
          Signed in with {profile.auth_provider} · joined{" "}
          {new Date(profile.created_at).toLocaleDateString()}
        </p>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </div>
    </>
  );
}
