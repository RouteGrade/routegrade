import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Founder request, 2026-08-05: optimise the UI/UX for the iPhone form factor
 * now that the app installs to the home screen.
 *
 * iOS Safari zooms the entire page when a focused text control renders below
 * 16px, and with `viewport-fit: cover` and a full-bleed map it does not
 * reliably zoom back out — the runner is left in a zoomed viewport with the map
 * clipped. There is no way to opt out of that zoom short of the
 * `maximum-scale=1` hack, which disables pinch-zoom for everyone and is an
 * accessibility regression we are not making. 16px is the only real fix.
 *
 * Five controls had drifted to `text-sm` (14px), including the email field on
 * the sign-in screen — the first input a newly-installed user ever touches.
 * Fixing those five is a one-time repair; this test is the part that lasts,
 * because the sixth would otherwise arrive unnoticed and only show up as "the
 * app zooms weirdly sometimes" months later.
 */

const SRC = path.resolve(__dirname, "..");

/** Tailwind text sizes that render below the 16px iOS zoom threshold. */
const UNDERSIZED = ["text-xs", "text-sm"];

function tsxFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...tsxFilesUnder(full));
    } else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The className of every `<input>` / `<textarea>` in a file.
 *
 * Deliberately crude: it reads the opening tag as the text between `<input`
 * and the first `className="..."` that follows it. That is enough to catch the
 * mistake this guards against — a size utility written inline on the control —
 * and it fails loudly rather than silently if a control is written some other
 * way, because such a control simply is not matched and the reviewer of a new
 * pattern should be the one to extend this.
 */
function controlClassNames(source: string): { tag: string; className: string }[] {
  const found: { tag: string; className: string }[] = [];
  const openings = /<(input|textarea)\b/g;
  let match: RegExpExecArray | null;

  while ((match = openings.exec(source)) !== null) {
    // Scan forward only to the end of this tag, so a className belonging to a
    // *later* element can never be attributed to this control.
    const rest = source.slice(match.index, match.index + 1200);
    const tagEnd = rest.indexOf("/>");
    const tag = tagEnd === -1 ? rest : rest.slice(0, tagEnd);
    const className = /className="([^"]*)"/.exec(tag);
    if (className) found.push({ tag: match[1], className: className[1] });
  }

  return found;
}

describe("iOS input zoom", () => {
  const files = tsxFilesUnder(SRC);

  it("finds source files to check", () => {
    // A broken glob would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(20);
  });

  it("parses controls out of a representative file", () => {
    // Pins the parser itself: if it silently stopped matching, the real
    // assertion below would pass while checking nothing.
    const explorer = files.find((f) => f.endsWith("route-explorer.tsx"));
    expect(explorer).toBeDefined();
    expect(controlClassNames(readFileSync(explorer!, "utf8")).length).toBeGreaterThan(0);
  });

  it("has no text control that renders below 16px", () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const { tag, className } of controlClassNames(readFileSync(file, "utf8"))) {
        const bad = UNDERSIZED.filter((size) =>
          new RegExp(`(^|[\\s:])${size}(\\s|$)`).test(className),
        );
        if (bad.length > 0) {
          offenders.push(`${path.relative(SRC, file)}: <${tag}> has ${bad.join(", ")}`);
        }
      }
    }

    expect(
      offenders,
      "iOS zooms the page when a focused control is under 16px; use text-base",
    ).toEqual([]);
  });
});
