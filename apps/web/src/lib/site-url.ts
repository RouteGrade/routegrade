// Resolve the origin the app is running on. Prefer the explicit
// `NEXT_PUBLIC_APP_URL` env var (build-time inlined by Next.js) so server- and
// client-computed values agree; otherwise read `window.location.origin` in the
// browser. The `http://localhost:3000` string is a last-resort dev fallback
// for SSR/build contexts without env config — production auth flows are all
// client-triggered, so they never hit it as long as either the env var is set
// or the code runs in a real browser.
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}
