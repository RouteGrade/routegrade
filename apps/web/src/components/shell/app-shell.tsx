"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { TabBar } from "./tab-bar";

/**
 * The mobile app frame: a full-height column with the active screen on top and
 * the tab bar pinned to the bottom edge.
 *
 * Screens are laid out inside a `min-h-0 flex-1` region so a full-bleed map can
 * fill exactly the space above the tab bar, and a scrolling list can scroll
 * within it, without either one fighting the viewport height on mobile Safari.
 *
 * Immersive screens (a live run, a full-screen route detail) hide the tab bar
 * via `useImmersive()` rather than rendering their own overlay above it — that
 * keeps a single source of truth for whether app chrome is showing.
 */

/** Only the mutators go in the context, so its identity never changes and
 *  consumers never re-render when the count moves. */
type ChromeContextValue = {
  enter: () => void;
  exit: () => void;
};

const ChromeContext = createContext<ChromeContextValue | null>(null);

export function AppShell({ children }: { children: React.ReactNode }) {
  // A count, not a boolean: nested immersive screens (a run screen opening a
  // scorecard) must not restore the tab bar when the inner one closes.
  const [immersiveCount, setImmersiveCount] = useState(0);

  const enter = useCallback(() => setImmersiveCount((n) => n + 1), []);
  const exit = useCallback(() => setImmersiveCount((n) => Math.max(0, n - 1)), []);
  const value = useMemo<ChromeContextValue>(() => ({ enter, exit }), [enter, exit]);

  return (
    <ChromeContext.Provider value={value}>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-canvas">
        <div className="relative min-h-0 flex-1">{children}</div>
        {immersiveCount === 0 && <TabBar />}
      </div>
    </ChromeContext.Provider>
  );
}

/**
 * Hide the tab bar for as long as `active` is true and the calling component is
 * mounted. Safe to call unconditionally with a changing flag.
 */
export function useImmersive(active: boolean) {
  const ctx = useContext(ChromeContext);
  const enter = ctx?.enter;
  const exit = ctx?.exit;

  useEffect(() => {
    if (!active || !enter || !exit) return;
    enter();
    return exit;
  }, [active, enter, exit]);
}
