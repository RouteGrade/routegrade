"use client";

import { useEffect, useState } from "react";
import { RouteGradeLoader } from "@/components/brand/route-grade-loader";
import { isNativePlatform } from "@/lib/location";

/**
 * The splash shown every time the app is opened.
 *
 * Three things hand off to each other on a cold start:
 *
 *   1. The native launch screen (a static image — iOS cannot animate one).
 *   2. This overlay, which draws the same mark, animated.
 *   3. The app.
 *
 * It is rendered by the server as part of the initial HTML, so it is on screen
 * in the very first painted frame rather than waiting for hydration. Only then
 * is the native launch screen dismissed, so there is never a frame of bare
 * webview between the two.
 *
 * "Opened" means a cold start — an app launch or a page load. It deliberately
 * does not re-run when the app returns from the background: iOS keeps the
 * webview alive, and a full splash on every task-switch would be noise. Client
 * side navigations don't retrigger it either, since this sits in the root
 * layout and never remounts.
 */

/**
 * Long enough for the one-shot draw (1.25s) to finish. Shortening this below
 * the animation cuts the mark off mid-stroke.
 */
const HOLD_MS = 1350;

/** Crossfade to the app. Also covers the native-to-web logo swap. */
const FADE_MS = 320;

export function AppSplash() {
  const [mounted, setMounted] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Dismiss the native launch screen now that this overlay is painted. It is
    // configured with launchAutoHide:false, so nothing else will.
    if (isNativePlatform()) {
      void import("@capacitor/splash-screen")
        .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 }))
        .catch(() => {
          // Plugin missing or already hidden. The web overlay still covers the
          // screen, so there is nothing to recover from.
        });
    }

    const hold = setTimeout(() => setLeaving(true), HOLD_MS);
    return () => clearTimeout(hold);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const done = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(done);
  }, [leaving]);

  if (!mounted) return null;

  return (
    <div
      // aria-hidden: the app behind it is the real content, and a screen
      // reader should not be parked on a decorative splash for a second.
      aria-hidden="true"
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-canvas transition-opacity duration-300 ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <RouteGradeLoader size="xl" loop={false} />
    </div>
  );
}
