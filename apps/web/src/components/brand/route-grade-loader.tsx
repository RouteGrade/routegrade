/**
 * Animated RouteGrade mark, used as the app's loading state.
 *
 * The logo is a route — a start dot, the R stem, the G bowl, an arrow — so the
 * loader draws it stroke by stroke instead of spinning something generic. It's
 * a redrawn stroked version of `public/logo.svg`, which is a traced *filled*
 * path and so cannot be dash-animated directly.
 *
 * Motion lives in `globals.css` (`.rg-loader-*`), which also handles
 * `prefers-reduced-motion` by showing the mark fully drawn and still.
 */

type Size = "sm" | "md" | "lg" | "xl";

const SIZE: Record<Size, { box: string; radius: string }> = {
  sm: { box: "h-10 w-10", radius: "rounded-lg" },
  md: { box: "h-16 w-16", radius: "rounded-card" },
  lg: { box: "h-24 w-24", radius: "rounded-[28px]" },
  // 176px, chosen to match the logo in the native launch image at its
  // on-screen size so the handoff between the two doesn't jump. If the splash
  // artwork is regenerated at a different logo size, this must move with it.
  xl: { box: "h-44 w-44", radius: "rounded-[40px]" },
};

/** The route through the R stem and around the G bowl. */
const ROUTE_PATH =
  "M 25 79 L 25 28 Q 25 19.5 33.5 19.5 L 63 19.5 Q 75.5 19.5 75.5 30 " +
  "Q 75.5 40.5 63 40.5 L 50 40.5 Q 38.5 40.5 38.5 52 L 38.5 66 " +
  "Q 38.5 80 52.5 80 L 70 80 Q 85.5 80 85.5 66 L 85.5 54";

/** The arrow inside the bowl — drawn last, as the "arrival". */
const ARROW_PATH = "M 50 60 L 73.5 60 M 67.5 54 L 73.5 60 L 67.5 66";

export function RouteGradeLoader({
  size = "md",
  loop = true,
  className,
}: {
  size?: Size;
  /** False draws the mark once and holds it — see `.rg-loader-once`. */
  loop?: boolean;
  className?: string;
}) {
  const s = SIZE[size];
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-flex items-center justify-center overflow-hidden bg-brand ${s.box} ${s.radius} ${loop ? "" : "rg-loader-once"} ${className ?? ""}`.trim()}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        <circle
          className="rg-loader-dot"
          cx="25"
          cy="79"
          r="4.6"
          fill="var(--color-brand-ink)"
        />
        <g
          fill="none"
          stroke="var(--color-brand-ink)"
          strokeWidth="7.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path className="rg-loader-route" d={ROUTE_PATH} />
          <path className="rg-loader-arrow" d={ARROW_PATH} />
        </g>
      </svg>
    </span>
  );
}

/**
 * Full-screen loading state on the app canvas. Used by the route-level
 * `loading.tsx` files, so a slow navigation shows the brand drawing itself
 * rather than a blank screen — which in the native shell is indistinguishable
 * from the app having hung.
 */
export function RouteGradeSplash({ label }: { label?: string }) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-5 bg-canvas">
      <RouteGradeLoader size="lg" />
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
          {label}
        </p>
      )}
    </div>
  );
}
