import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for use in Server Components, Route Handlers,
 * and Server Actions. Reads and writes the session cookies via Next.js.
 *
 * IMPORTANT: For request authorization, always prefer `supabase.auth.getUser()`
 * or `supabase.auth.getClaims()` (which re-validate against Supabase) over
 * `getSession()`, whose user object is not verified.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components cannot write cookies — Supabase falls back to the
        // proxy for session refresh in that case, which is exactly what we want.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — ignore. `proxy.ts` handles refreshes.
        }
      },
    },
  });
}
