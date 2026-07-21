"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";

export function GoogleSignInButton({ next }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const params = new URLSearchParams();
      if (next) params.set("next", next);
      const redirectTo = `${getSiteUrl()}/auth/callback${params.toString() ? `?${params}` : ""}`;
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (err) {
        setError("Could not start Google sign-in. Please try again.");
        setBusy(false);
      }
      // On success, Supabase redirects the browser; do NOT reset busy.
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-70"
        aria-label="Continue with Google"
      >
        <GoogleIcon />
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
