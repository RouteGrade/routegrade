import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 renamed middleware to "proxy". Runs on every matched request to
 * refresh the Supabase session cookies so pages see a consistent auth state.
 *
 * Contract with `@supabase/ssr`:
 *   1. Read cookies from the incoming request.
 *   2. When Supabase decides to refresh, call `setAll` to write new cookies
 *      to BOTH the mutated request (so downstream handlers see the fresh
 *      session) and the outgoing response (so the browser stores it).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // If Supabase isn't configured (e.g. MVP 1 baseline dev), no-op. Public MVP 1
  // pages must remain reachable without any Supabase setup.
  if (!url || !key) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [k, v] of Object.entries(headers)) {
          response.headers.set(k, v);
        }
      },
    },
  });

  // Force a token check early so any pending refresh writes cookies here (and
  // not after the response has been sent, which would silently lose them).
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // Skip static assets and Next internals; run on everything else so protected
  // pages always see a fresh session.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
