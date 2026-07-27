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
        className="rounded-control border border-volt/40 bg-volt-wash p-4 text-sm text-volt"
      >
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-xs text-volt/80">
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
          className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted"
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
          className="h-11 w-full rounded-control border border-hairline bg-raised px-3 text-sm text-ink placeholder:text-faint outline-none transition focus:border-volt"
        />
      </div>
      <button
        type="submit"
        disabled={status === "sending"}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-control border border-hairline bg-raised text-sm font-semibold text-ink transition hover:bg-white/20 disabled:cursor-wait disabled:opacity-70"
      >
        {status === "sending" ? "Sending link…" : "Email me a sign-in link"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
