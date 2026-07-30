"use client";

import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativePlatform } from "@/lib/location";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeRedirect } from "@/lib/utils/safe-redirect";

/**
 * Custom URL scheme registered in `ios/App/App/Info.plist`.
 *
 * A custom scheme rather than a Universal Link on purpose: Universal Links
 * require the Associated Domains entitlement, which Apple does not issue to
 * free personal teams. The tradeoff is that iOS may show a one-time
 * "Open in RouteGrade?" confirmation on the Safari hand-off.
 */
export const NATIVE_SCHEME = "com.routegrade.app";
export const NATIVE_AUTH_CALLBACK = `${NATIVE_SCHEME}://auth/callback`;

/**
 * Where the provider should send the user once they've authenticated.
 *
 * On the web this is the `/auth/callback` route handler, which exchanges the
 * code server-side and writes the session cookies. In the native shell it is
 * the custom scheme instead — the whole point being that the callback has to
 * re-enter the app. Sending a native sign-in to the https origin is what
 * leaves the user signed in inside Safari, looking at the web build, with the
 * app itself still logged out.
 */
export function authRedirectTo(next?: string): string {
  const params = new URLSearchParams();
  if (next) params.set("next", next);
  const query = params.toString() ? `?${params}` : "";

  return isNativePlatform()
    ? `${NATIVE_AUTH_CALLBACK}${query}`
    : `${getSiteUrl()}/auth/callback${query}`;
}

/**
 * Begin Google sign-in.
 *
 * Web: hand off to Supabase, which navigates the tab to Google.
 *
 * Native: ask Supabase for the URL but forbid it from navigating
 * (`skipBrowserRedirect`), then open that URL in an in-app SFSafariViewController.
 * Two independent reasons this cannot just navigate the webview:
 *
 *   1. Google rejects OAuth attempts from embedded webviews outright with
 *      `disallowed_useragent`, so the flow has to run in a real browser.
 *   2. PKCE keeps its code verifier in *this* JS context's storage. Navigating
 *      the webview away discards it, and the later code exchange then fails
 *      with no obvious cause.
 *
 * Returns an error string rather than throwing, because every caller renders
 * it inline next to the button.
 */
export async function startGoogleSignIn(next?: string): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const redirectTo = authRedirectTo(next);

  if (!isNativePlatform()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    return error ? "Could not start Google sign-in. Please try again." : null;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    return "Could not start Google sign-in. Please try again.";
  }

  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return null;
}

export type NativeAuthResult =
  | { status: "signed-in"; next: string }
  | { status: "failed" }
  | { status: "ignored" };

/**
 * Finish a sign-in that came back in over the custom scheme.
 *
 * Runs entirely client-side: the code is exchanged here rather than by the
 * `/auth/callback` route handler, because the PKCE verifier lives in the
 * webview and the native callback never touches the Next server.
 * `createBrowserClient` persists the resulting session to cookies, so server
 * components on the next navigation see the user as signed in.
 */
export async function completeNativeAuth(url: string): Promise<NativeAuthResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "ignored" };
  }

  // Other deep links may exist later (shared routes, for one). Only claim the
  // auth callback.
  if (parsed.protocol !== `${NATIVE_SCHEME}:` || parsed.host !== "auth") {
    return { status: "ignored" };
  }

  // Close the in-app browser first so the runner isn't staring at a spinning
  // Safari sheet while the exchange happens.
  await Browser.close().catch(() => {
    // Nothing to close if the callback arrived from Mail rather than our own
    // SFSafariViewController. Not an error.
  });

  // The provider reports failure (consent denied, expired link) as query
  // params, not as a missing code — surface it rather than reporting success.
  if (parsed.searchParams.get("error")) {
    return { status: "failed" };
  }

  const code = parsed.searchParams.get("code");
  if (!code) return { status: "failed" };

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return { status: "failed" };

  // `next` arrives from outside the app, so it gets the same open-redirect
  // treatment the web callback route applies.
  return {
    status: "signed-in",
    next: safeRedirect(parsed.searchParams.get("next"), "/"),
  };
}

/**
 * Subscribe to deep links. Returns an unsubscribe function.
 */
export async function onAuthDeepLink(
  handler: (url: string) => void,
): Promise<() => void> {
  const listener = await CapacitorApp.addListener("appUrlOpen", ({ url }) => {
    handler(url);
  });
  return () => {
    void listener.remove();
  };
}
