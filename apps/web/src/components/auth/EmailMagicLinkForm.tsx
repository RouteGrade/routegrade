"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";

type Status = "idle" | "sending" | "sent";

export function EmailMagicLinkForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }

    setStatus("sending");
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const params = new URLSearchParams();
      if (next) params.set("next", next);
      const emailRedirectTo = `${getSiteUrl()}/auth/callback${params.toString() ? `?${params}` : ""}`;
      const { error: err } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo },
      });
      if (err) {
        // Deliberately vague — do not disclose whether the email is registered.
        setError("We couldn't send the link. Please try again shortly.");
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setError("We couldn't send the link. Please try again shortly.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200"
      >
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-xs text-emerald-100/80">
          If an account exists for that address, we&apos;ve sent a sign-in link.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label
          htmlFor="magic-email"
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
        >
          Email
        </label>
        <input
          id="magic-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="runner@example.com"
          className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-zinc-500 outline-none transition focus:border-emerald-400/60 focus:bg-white/10 focus:ring-2 focus:ring-emerald-400/20"
        />
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-70"
      >
        {status === "sending" ? "Sending link…" : "Email me a sign-in link"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      )}
    </form>
  );
}
