"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { RouteGradeMark } from "@/components/brand/route-grade-logo";
import {
  ApiError,
  fetchCurrentUser,
  provisionCurrentUser,
  updateDisplayName,
  type UserProfile,
} from "@/lib/api/authenticated-client";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; profile: UserProfile }
  | { kind: "error"; message: string };

export function AccountView() {
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

  async function onRefresh() {
    if (state.kind !== "ready") return;
    setSaving(true);
    setSaveError(null);
    try {
      const profile = await fetchCurrentUser();
      setState({ kind: "ready", profile });
      setDraftName(profile.display_name ?? "");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not refresh.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-dvh w-full items-start justify-center bg-zinc-950 p-6">
      <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-900/60 p-6 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <RouteGradeMark />
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-white">
                Your account
              </h1>
              <p className="text-[11px] leading-tight text-zinc-400">
                Manage how you appear in RouteGrade.
              </p>
            </div>
          </div>
          <SignOutButton />
        </header>

        {state.kind === "loading" && (
          <p className="text-sm text-zinc-400">Loading your profile…</p>
        )}

        {state.kind === "error" && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
            <p className="text-sm text-rose-200">{state.message}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-rose-500/20 px-3 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
            >
              Try again
            </button>
          </div>
        )}

        {state.kind === "ready" && (
          <>
            <div className="flex items-center gap-4">
              {state.profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={state.profile.avatar_url}
                  alt=""
                  className="h-14 w-14 rounded-full border border-white/10 object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-emerald-400/30 to-cyan-400/30 text-lg font-semibold text-emerald-200"
                >
                  {(state.profile.display_name ?? state.profile.email)
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {state.profile.display_name ?? "Runner"}
                </p>
                <p className="truncate text-xs text-zinc-400">{state.profile.email}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">
                  Signed in with {state.profile.auth_provider} · joined{" "}
                  {new Date(state.profile.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            <form onSubmit={onSave} className="mt-6 flex flex-col gap-3">
              <label
                htmlFor="display_name"
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
              >
                Display name
              </label>
              <input
                id="display_name"
                type="text"
                maxLength={80}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-emerald-400/60 focus:bg-white/10 focus:ring-2 focus:ring-emerald-400/20"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 px-4 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>
              {saveError && (
                <p role="alert" className="text-xs text-rose-400">
                  {saveError}
                </p>
              )}
            </form>

            <p className="mt-6 text-xs text-zinc-500">
              <Link href="/" className="text-emerald-400 hover:text-emerald-300">
                Back to routes
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
