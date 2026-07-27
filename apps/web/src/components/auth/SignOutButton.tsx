"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } finally {
      // Always route back to the public home, even if sign-out throws.
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={
        className ??
        "inline-flex h-9 items-center justify-center rounded-lg border border-hairline bg-raised px-3 text-xs font-semibold text-ink transition hover:bg-raised disabled:opacity-60"
      }
    >
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
