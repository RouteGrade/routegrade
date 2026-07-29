"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes RouteGrade installable.
 *
 * Development is skipped on purpose: a worker holding onto `/_next/static/*`
 * fights the dev server's hot reload and produces stale-bundle bugs that look
 * like application bugs. Test installability against a production build.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Registration competes with the app's own first data fetches; waiting for
    // load keeps it off the critical path to a usable map.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs offline support, nothing more — the app
        // works fine without it, so this must never surface to the runner.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
