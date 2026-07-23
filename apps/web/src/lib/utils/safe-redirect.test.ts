import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it("passes through a same-origin path", () => {
    expect(safeRedirect("/account")).toBe("/account");
    expect(safeRedirect("/?route=abc123")).toBe("/?route=abc123");
  });

  it("defaults to / when next is missing", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect("")).toBe("/");
  });

  it("honors a custom fallback", () => {
    expect(safeRedirect(null, "/account")).toBe("/account");
    expect(safeRedirect(undefined, "/account")).toBe("/account");
  });

  it("rejects protocol-relative URLs (open-redirect via //evil.com)", () => {
    expect(safeRedirect("//evil.com")).toBe("/");
    expect(safeRedirect("//evil.com/phish")).toBe("/");
  });

  it("rejects backslash tricks browsers may treat as protocol-relative", () => {
    expect(safeRedirect("/\\evil.com")).toBe("/");
  });

  it("rejects embedded control characters the URL parser would strip, re-exposing //host", () => {
    // The WHATWG URL parser drops ASCII tab/newline/CR anywhere in the
    // input, so "/\t/evil.com" collapses to "//evil.com" once it reaches
    // `new URL()` or Next's `redirect()` even though it isn't caught by the
    // plain-string //-prefix check above.
    expect(safeRedirect("/\t/evil.com")).toBe("/");
    expect(safeRedirect("/\n/evil.com")).toBe("/");
    expect(safeRedirect("/\r/evil.com")).toBe("/");
    expect(new URL(safeRedirect("/\t/evil.com", "/") || "/", "https://routegrade.example").origin).toBe(
      "https://routegrade.example",
    );
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.com")).toBe("/");
    expect(safeRedirect("http://evil.com/login")).toBe("/");
  });

  it("rejects paths that don't start with a single slash", () => {
    expect(safeRedirect("account")).toBe("/");
    expect(safeRedirect("javascript:alert(1)")).toBe("/");
  });
});
