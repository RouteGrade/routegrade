import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Small session-aware nav pill rendered on the public home page.
 * Signed out: shows "Sign in". Signed in: shows "Account".
 *
 * Uses getUser() so it reflects Supabase's authoritative session state, not the
 * potentially stale local session object.
 */
export async function SessionNav() {
  let user: { id: string; email?: string | null } | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase not configured or unreachable — fall through to signed-out UI.
    user = null;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
      >
        Sign in
      </Link>
    );
  }

  const initial = (user.email ?? "R").slice(0, 1).toUpperCase();
  return (
    <Link
      href="/account"
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 pr-3 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
      aria-label="Open account"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br from-emerald-400/30 to-cyan-400/30 text-[10px] font-bold text-emerald-100">
        {initial}
      </span>
      Account
    </Link>
  );
}
