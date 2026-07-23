/**
 * Return `next` iff it is a same-origin path (i.e. starts with a single "/").
 * Rejects protocol-relative (`//evil.com`) and absolute URLs to prevent
 * open-redirect abuse of the auth callback.
 */
export function safeRedirect(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (typeof next !== "string") return fallback;
  // The WHATWG URL parser strips ASCII tab/newline/carriage-return characters
  // *anywhere* in the input before parsing, so "/\t/evil.com" collapses to
  // "//evil.com" -- a protocol-relative URL -- once passed to `new URL()` or
  // Next's `redirect()`, even though it doesn't look like one here. Reject
  // any C0 control character outright rather than trying to out-guess the
  // parser's normalization rules.
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i);
    if (code <= 0x1f) return fallback;
  }
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.startsWith("/\\")) return fallback;
  return next;
}
