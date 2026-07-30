import { RouteGradeMark } from "./route-grade-logo";

/**
 * Loading indicator built from the brand mark itself: a dim copy of the logo
 * with a full-colour copy rising through it, so the thing that says "we're
 * fetching" is the same shape as the thing that says "RouteGrade".
 *
 * Works determinate or indeterminate. Most loads in this app are a single
 * fetch with no meaningful percentage, so indeterminate is the default and the
 * fill loops; pass `value` only when there is a real fraction to report,
 * because a bar that reports a made-up percentage is worse than one that
 * admits it doesn't know.
 */

type Size = "sm" | "md" | "lg";

export function BrandLoader({
  label = "Loading",
  value,
  size = "md",
  className,
}: {
  /** Announced to screen readers and shown beside the mark. */
  label?: string;
  /** 0–1. Omit for indeterminate. */
  value?: number;
  size?: Size;
  className?: string;
}) {
  const determinate = typeof value === "number" && Number.isFinite(value);
  const pct = determinate ? Math.round(Math.min(1, Math.max(0, value)) * 100) : undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      // Omitted entirely when indeterminate — that absence is exactly how a
      // screen reader is told the length is unknown.
      aria-valuenow={pct}
      className={`flex items-center gap-3 ${className ?? ""}`.trim()}
    >
      <span
        className={`brand-loader ${determinate ? "" : "brand-loader-indeterminate"}`}
      >
        <RouteGradeMark size={size} className="brand-loader-base" />
        <RouteGradeMark
          size={size}
          className="brand-loader-fill"
          style={determinate ? { clipPath: `inset(${100 - pct!}% 0 0 0)` } : undefined}
        />
      </span>
      <span className="rg-label">{label}</span>
    </div>
  );
}
