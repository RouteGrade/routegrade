import Link from "next/link";

/**
 * Entry point into the address-based route builder from the Routes tab.
 *
 * The Run tab hands off via `?build=1`, which the planner reads to open the
 * builder straight away instead of the search form. (This replaced the freehand
 * draw tool, shelved 2026-07-23 behind `ROUTE_DRAW_ENABLED`.)
 */
export function BuildRouteCard() {
  return (
    <Link
      href="/?build=1"
      className="group flex items-center gap-4 rounded-card border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-canvas">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <circle cx="12" cy="10" r="3" />
          <path d="M12 2a8 8 0 0 0-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 0 0-8-8z" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block rg-display text-lg uppercase text-ink">
          Create your own
        </span>
        <span className="mt-1 block text-sm text-muted">
          Set a start, end and any stops along the way — we route it and grade it.
        </span>
      </span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}
