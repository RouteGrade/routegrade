"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * The app's primary navigation: a fixed bottom tab bar, the spine of the
 * mobile experience. Four destinations, thumb-reachable, always visible.
 *
 * Active state comes from `useSelectedLayoutSegment()` rather than the full
 * pathname so a nested route (e.g. /activity/<id>) still lights up its tab.
 * The home tab is `null` as a segment, which is why `segment` is compared
 * against a nullable `segment` field instead of a href prefix.
 */

type Tab = {
  /** Layout segment under (app); `null` for the index route. */
  segment: string | null;
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
};

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const TABS: Tab[] = [
  {
    segment: null,
    href: "/",
    label: "Run",
    icon: (active) =>
      active ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 6.1 5.4 3.2a.8.8 0 0 1 0 1.4l-5.4 3.2a.8.8 0 0 1-1.2-.7V8.8a.8.8 0 0 1 1.2-.7Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" {...strokeProps} className="h-6 w-6">
          <circle cx="12" cy="12" r="9" />
          <path d="M10.5 8.8v6.4l5.2-3.2z" />
        </svg>
      ),
  },
  {
    segment: "routes",
    href: "/routes",
    label: "Routes",
    icon: (active) => (
      <svg
        viewBox="0 0 24 24"
        {...strokeProps}
        strokeWidth={active ? 2.6 : 2}
        className="h-6 w-6"
      >
        <path d="M4 18c0-3 3-3.5 5-5s2-4-1-4" />
        <path d="M9 18h7a3 3 0 0 0 0-6" />
        <circle cx="5" cy="18" r="2" />
        <circle cx="19" cy="7" r="2" />
      </svg>
    ),
  },
  {
    segment: "activity",
    href: "/activity",
    label: "Activity",
    icon: (active) => (
      <svg
        viewBox="0 0 24 24"
        {...strokeProps}
        strokeWidth={active ? 2.6 : 2}
        className="h-6 w-6"
      >
        <path d="M3 13h3.5l2-6 3.5 12 2.5-8 1.8 4H21" />
      </svg>
    ),
  },
  {
    segment: "you",
    href: "/you",
    label: "You",
    icon: (active) => (
      <svg
        viewBox="0 0 24 24"
        {...strokeProps}
        strokeWidth={active ? 2.6 : 2}
        className="h-6 w-6"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
  },
];

export function TabBar() {
  const segment = useSelectedLayoutSegment();

  return (
    <nav
      aria-label="Primary"
      className="z-40 shrink-0 border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex h-[58px] max-w-lg items-stretch">
        {TABS.map((tab) => {
          const active = segment === tab.segment;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 transition-colors ${
                  active ? "text-accent" : "text-faint hover:text-muted"
                }`}
              >
                {tab.icon(active)}
                <span className="text-[10px] font-bold uppercase tracking-[0.12em]">
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
