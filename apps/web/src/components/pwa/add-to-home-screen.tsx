"use client";

import { useEffect, useRef, useState } from "react";
import { RouteGradeMark } from "@/components/brand/route-grade-logo";
import { useInstallPrompt } from "./use-install-prompt";

/**
 * The first thing a new visitor sees: an offer to install RouteGrade to the
 * Home Screen, before they sign in.
 *
 * Before, not after, for a concrete reason. Since iOS 16.4 a Home Screen web
 * app gets its own storage partition, separate from Safari's — a visitor who
 * signs in first and installs second arrives in the installed app signed out
 * and has to do it all again. Installing first means signing in once.
 *
 * It shows once. "Not now" is remembered in localStorage, and the step never
 * appears at all once the app is installed (or inside the native shell), so
 * there is no way to end up nagged by it on every launch.
 */

/** iOS Share: a box with an arrow leaving through the top. */
function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3.25v11.5" />
      <path d="M8.25 7 12 3.25 15.75 7" />
      <path d="M7.5 10.5H5.75A1.75 1.75 0 0 0 4 12.25v7A1.75 1.75 0 0 0 5.75 21h12.5A1.75 1.75 0 0 0 20 19.25v-7a1.75 1.75 0 0 0-1.75-1.75H16.5" />
    </svg>
  );
}

/** The "Add to Home Screen" row icon: a plus in a rounded square. */
function AddToHomeGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="4.75" />
      <path d="M12 8.25v7.5M8.25 12h7.5" />
    </svg>
  );
}

function Step({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-bold text-ink"
      >
        {n}
      </span>
      <span className="text-sm leading-relaxed text-muted">{children}</span>
    </li>
  );
}

/** An icon sitting inline in a sentence, at the size of the text around it. */
function InlineGlyph({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex translate-y-[3px] text-ink">{children}</span>
  );
}

type Props = {
  /**
   * Omit both props for the first-run step: it shows itself when the browser
   * can install and the visitor hasn't turned it down, and closing it is
   * remembered. Pass both to drive it as a plain overlay from elsewhere (the
   * You tab), where closing is just closing and changes nothing persistent.
   */
  open?: boolean;
  onClose?: () => void;
};

export function AddToHomeScreenStep({ open, onClose }: Props) {
  const { platform, dismissed, canPromptDirectly, install, dismiss } =
    useInstallPrompt();
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const controlled = onClose !== undefined;
  const close = controlled ? onClose : dismiss;

  // `platform` is null until detection runs on the client — see the hook. On
  // "none" (desktop, already installed, native shell) there is nothing to offer.
  const hidden =
    platform === null ||
    platform === "none" ||
    (controlled ? !open : dismissed);

  useEffect(() => {
    // `aria-modal` tells assistive tech to ignore the sign-in form behind this,
    // but it does nothing for keyboard focus — which would otherwise still be
    // sitting on a covered field. Moving it here is enough for a screen that
    // has at most two controls; a full focus trap would be more machinery than
    // this earns.
    if (!hidden) panel.current?.focus();
  }, [hidden]);

  if (hidden) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      // Clipboard is permission-gated and absent over plain HTTP. The URL is on
      // screen in the address bar regardless, so there is nothing to report.
    }
  }

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-heading"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-canvas outline-none px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]"
    >
      <div className="m-auto w-full max-w-sm py-6">
        <RouteGradeMark size="lg" />

        <h1 id="install-heading" className="rg-display mt-6 text-3xl text-ink">
          Put RouteGrade on your Home Screen
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          It gets its own icon and opens full screen with no address bar — the
          same as an app from the App Store, without the download.
        </p>

        {platform === "ios-safari" && (
          <>
            <ol className="mt-7 flex flex-col gap-4">
              <Step n={1}>
                Tap
                <InlineGlyph>
                  <ShareGlyph className="h-[1.15em] w-[1.15em]" />
                </InlineGlyph>
                <span className="text-ink">Share</span> in the Safari toolbar.
              </Step>
              <Step n={2}>
                Scroll down and tap
                <InlineGlyph>
                  <AddToHomeGlyph className="h-[1.15em] w-[1.15em]" />
                </InlineGlyph>
                <span className="text-ink">Add to Home Screen</span>.
              </Step>
              <Step n={3}>
                Tap <span className="text-ink">Add</span>, then open RouteGrade
                from your Home Screen.
              </Step>
            </ol>
            <p className="mt-6 text-xs leading-relaxed text-faint">
              Worth doing before you sign in: the Home Screen app keeps its own
              session, so installing first saves you signing in twice.
            </p>
          </>
        )}

        {platform === "ios-other-browser" && (
          <>
            <ol className="mt-7 flex flex-col gap-4">
              <Step n={1}>
                Open <span className="text-ink">{window.location.host}</span> in{" "}
                <span className="text-ink">Safari</span> — only Safari can add a
                page to the Home Screen on iPhone.
              </Step>
              <Step n={2}>
                Tap
                <InlineGlyph>
                  <ShareGlyph className="h-[1.15em] w-[1.15em]" />
                </InlineGlyph>
                <span className="text-ink">Share</span>, then{" "}
                <span className="text-ink">Add to Home Screen</span>.
              </Step>
            </ol>
            <button
              type="button"
              onClick={copyLink}
              className="rg-btn rg-btn-secondary mt-7 w-full"
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
          </>
        )}

        {platform === "android" && (
          <>
            <p className="mt-7 text-sm leading-relaxed text-muted">
              {canPromptDirectly
                ? "One tap — Chrome will ask you to confirm."
                : "Open the browser menu and choose Install app (or Add to Home screen)."}
            </p>
            {canPromptDirectly && (
              <button
                type="button"
                onClick={() =>
                  void install().then((accepted) => {
                    // Uncontrolled, the hook has already hidden this. Controlled,
                    // only the owner can close it.
                    if (accepted) close();
                  })
                }
                className="rg-btn rg-btn-primary mt-6 w-full"
              >
                Install app
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={close}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-full text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:text-ink"
        >
          {controlled
            ? "Done"
            : platform === "android" && canPromptDirectly
              ? "Not now"
              : "Continue in the browser"}
        </button>
      </div>
    </div>
  );
}
