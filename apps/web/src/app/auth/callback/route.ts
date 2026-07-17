import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/utils/safe-redirect";

/**
 * OAuth / magic-link callback:
 *   1. Read the authorization code from the query string.
 *   2. Exchange it for a session (Supabase writes session cookies).
 *   3. Redirect to a same-origin `next` destination, defaulting to /account.
 *   4. On any failure, redirect back to /login with a non-sensitive error state.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next");
  const nextPath = safeRedirect(rawNext, "/account");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=callback", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=callback", url.origin));
  }

  return NextResponse.redirect(new URL(nextPath, url.origin));
}
