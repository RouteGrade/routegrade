"use client";

import { useCallback, useEffect, useState } from "react";
import {
  detectInstallPlatform,
  dismissInstallPrompt,
  isInstallPromptDismissed,
  type BeforeInstallPromptEvent,
  type InstallPlatform,
} from "@/lib/pwa/install";

/**
 * Chromium fires `beforeinstallprompt` once, on its own schedule, and the event
 * is only replayable if you called `preventDefault()` on it. That can easily
 * happen before any component has mounted, so the listener is registered at
 * module scope — as early as this bundle runs — and the event is parked here
 * for whichever component asks for it later.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppresses Chrome's own mini-infobar so it can't compete with our step.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    for (const notify of subscribers) notify();
  });

  window.addEventListener("appinstalled", () => {
    // Single-use: Chromium will not let the same event be prompted twice.
    deferredPrompt = null;
    for (const notify of subscribers) notify();
  });
}

export type InstallPromptState = {
  /**
   * Null until detection has run on the client. Rendering nothing while this is
   * null is what keeps the server HTML and the first client render identical —
   * none of the signals detection needs exist during SSR.
   */
  platform: InstallPlatform | null;
  /** True once the app is installed, or the user chose "Not now". */
  dismissed: boolean;
  /** True when Chromium has given us a prompt we can actually replay. */
  canPromptDirectly: boolean;
  /** Android only. Resolves to whether the user accepted. */
  install: () => Promise<boolean>;
  /** Hide the step and remember that, so it doesn't come back. */
  dismiss: () => void;
};

export function useInstallPrompt(): InstallPromptState {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [canPromptDirectly, setCanPromptDirectly] = useState(false);

  useEffect(() => {
    const sync = () => {
      setPlatform(detectInstallPlatform());
      setDismissed(isInstallPromptDismissed());
      setCanPromptDirectly(deferredPrompt !== null);
    };

    sync();
    subscribers.add(sync);

    // An iOS install leaves the Safari tab open and fires nothing, so there is
    // no event to catch there. On Android this covers the user installing from
    // Chrome's own menu while our step is on screen.
    window.addEventListener("appinstalled", sync);
    return () => {
      subscribers.delete(sync);
      window.removeEventListener("appinstalled", sync);
    };
  }, []);

  const install = useCallback(async () => {
    const event = deferredPrompt;
    if (!event) return false;
    // Clear first: `prompt()` can only be called once per event, and leaving it
    // in place would let a double tap throw.
    deferredPrompt = null;
    setCanPromptDirectly(false);

    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") {
      dismissInstallPrompt();
      setDismissed(true);
      return true;
    }
    return false;
  }, []);

  const dismiss = useCallback(() => {
    dismissInstallPrompt();
    setDismissed(true);
  }, []);

  return { platform, dismissed, canPromptDirectly, install, dismiss };
}
