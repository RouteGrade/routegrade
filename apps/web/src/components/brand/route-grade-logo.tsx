import type { HTMLAttributes } from "react";

/**
 * RouteGrade brand mark — the official SVG monogram at `public/logo.svg`.
 * Single source of truth for the logo. Every page uses <RouteGradeMark /> or
 * <RouteGradeLogo /> so the brand stays consistent and updates in one place.
 */

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, { box: string; radius: string }> = {
  sm: { box: "h-8 w-8", radius: "rounded-lg" },
  md: { box: "h-10 w-10", radius: "rounded-xl" },
  lg: { box: "h-14 w-14", radius: "rounded-2xl" },
};

type MarkProps = { size?: Size } & Omit<HTMLAttributes<HTMLSpanElement>, "aria-hidden">;

export function RouteGradeMark({ size = "md", className, ...rest }: MarkProps) {
  const s = SIZE[size];
  return (
    <span
      aria-hidden="true"
      {...rest}
      className={`inline-flex items-center justify-center overflow-hidden ${s.box} ${s.radius} shadow-lg shadow-emerald-500/20 ring-1 ring-white/10 ${className ?? ""}`.trim()}
    >
      {/* Plain <img> for the SVG — no next/image config needed, it's already tiny. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" className="h-full w-full object-cover" />
    </span>
  );
}

type LogoProps = {
  size?: Size;
  tagline?: boolean;
  className?: string;
};

/**
 * Icon + "RouteGrade" wordmark. Optional tagline under the name.
 * Screen readers see the wordmark text; the icon is decorative (`aria-hidden`).
 */
export function RouteGradeLogo({ size = "md", tagline = false, className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ""}`.trim()}>
      <RouteGradeMark size={size} />
      <span className="flex flex-col leading-tight">
        <span className="font-display text-lg font-bold tracking-tight text-white">
          RouteGrade
        </span>
        {tagline && (
          <span className="text-[11px] text-zinc-400">Run routes, graded.</span>
        )}
      </span>
    </span>
  );
}
