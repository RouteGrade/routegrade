/**
 * Return `next` iff it is a same-origin path (i.e. starts with a single "/").
 * Rejects protocol-relative (`//evil.com`) and absolute URLs to prevent
 * open-redirect abuse of the auth callback.
 */
export function safeRedirect(next: string | null | undefined, fallback = "/account"): string {
  if (!next) return fallback;
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;
  return next;
}
