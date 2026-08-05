"use client";

import { useState } from "react";
import { AddToHomeScreenStep } from "./add-to-home-screen";
import { useInstallPrompt } from "./use-install-prompt";

/**
 * The standing way back to the install step, for anyone who tapped "Not now"
 * on it at sign-in. Without this, turning the first-run step down once would
 * put installing permanently out of reach.
 *
 * Renders nothing on a browser that can't install, or once the app already is.
 */
export function InstallAppRow() {
  const { platform } = useInstallPrompt();
  const [open, setOpen] = useState(false);

  if (platform === null || platform === "none") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center justify-between rounded-control border border-hairline bg-surface px-4 py-3.5 text-left transition-colors hover:bg-raised"
      >
        <span>
          <span className="block text-sm font-semibold text-ink">
            Add to Home Screen
          </span>
          <span className="block text-xs text-muted">
            Open RouteGrade full screen, like an installed app
          </span>
        </span>
        <span aria-hidden="true" className="ml-3 text-muted">
          ›
        </span>
      </button>

      <AddToHomeScreenStep open={open} onClose={() => setOpen(false)} />
    </>
  );
}
