import { NextResponse, type NextRequest } from "next/server";
import { safeRedirect } from "@/lib/utils/safe-redirect";

// Mirrors the Supabase session cookie's lifetime so a guest choice sticks as
// long as a real sign-in would.
const GUEST_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * "Continue as guest" from /login: marks this browser as having opted into
 * guest mode (so the entry gate in proxy.ts doesn't show again) and sends
 * them on to wherever they were headed.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const rawNext = formData.get("next");
  const nextPath = safeRedirect(typeof rawNext === "string" ? rawNext : null, "/");

  // 303: convert the browser's POST into a GET on the destination — a 307
  // (NextResponse.redirect's default) would re-POST this form to "/".
  const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
  response.cookies.set("rg_guest", "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_S,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
