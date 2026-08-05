import type { Activity } from "@/lib/api/routes-client";

/**
 * The run and ride glyphs, in one place.
 *
 * These started inline in the planner's Run/Ride toggle. The Routes tab now
 * needs the same two marks — on its own filter, and as a per-row badge — and a
 * second hand-drawn pair would drift the moment either is nudged. The runner
 * learns "this shape means ride" once; that only holds if it is literally the
 * same shape everywhere.
 *
 * `aria-hidden` throughout: every caller here pairs the icon with a real text
 * label, so announcing it again would just make screen readers say "ride ride".
 */

export function ActivityIcon({
  activity,
  className = "h-4 w-4",
}: {
  activity: Activity;
  className?: string;
}) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
  } as const;

  if (activity === "ride") {
    return (
      <svg {...shared}>
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <circle cx="15" cy="5" r="1" />
        <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <circle cx="13" cy="4" r="1" />
      <path d="m9 20 3-6 3 2 2 4" />
      <path d="M6 12 8 8l4-1 3 3 3 1" />
    </svg>
  );
}
