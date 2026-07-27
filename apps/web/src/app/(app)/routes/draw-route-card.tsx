import Link from "next/link";

/**
 * Entry point into draw-your-own-route from the Routes tab.
 *
 * The Run tab hands off via `?draw=1`, which the planner reads to open straight
 * into draw mode instead of the search form.
 */
export function DrawRouteCard() {
  return (
    <Link
      href="/?draw=1"
      className="group flex items-center gap-4 rounded-card border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-volt text-canvas">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <path d="M2 2l7.586 7.586" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block rg-display text-lg uppercase text-ink">
          Draw your own
        </span>
        <span className="mt-1 block text-sm text-muted">
          Trace a route with your finger — we snap it to the streets and grade it.
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
