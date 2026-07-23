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
  const { data, error } = await supabase.auth.getClaims();
  const authenticated = data?.claims != null;

  // First-touch gate: an unauthenticated visitor who has never chosen guest
  // mode lands on /login instead of the planner. Anyone who has signed in
  // before, or already clicked "Continue as guest" (rg_guest cookie), skips
  // straight through — this only fires once per browser. Fail open on a
  // getClaims error (distinct from "no session" — see the return type):
  // login/page.tsx checks auth via getUser() instead, and a transient
  // getClaims failure while getUser still succeeds would otherwise bounce a
  // genuinely signed-in visitor in an endless "/" -> /login -> "/" loop.
  if (
    request.nextUrl.pathname === "/" &&
    !authenticated &&
    !error &&
    !request.cookies.has("rg_guest")
  ) {
    const loginUrl = new URL("/login", request.url);
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (next !== "/") loginUrl.searchParams.set("next", next);
    const redirectResponse = NextResponse.redirect(loginUrl);
    // Carry over any session-refresh cookies staged on `response` above —
    // dropping them here would silently lose a concurrent token refresh —
    // plus the cache-control headers @supabase/ssr requires alongside any
    // auth cookie, so a CDN/reverse proxy never caches (and replays to a
    // different visitor) a response carrying someone's session cookie.
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirectResponse.headers.set(header, value);
    }
    return redirectResponse;
  }

  return response;
}

export const config = {
  // Skip static assets and Next internals; run on everything else so protected
  // pages always see a fresh session.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
