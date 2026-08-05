/**
 * Detection for the "add RouteGrade to your Home Screen" step.
 *
 * Installing a web app to the Home Screen is the closest thing we have to
 * shipping through the App Store today: iOS gives an installed page its own
 * icon, a standalone frame with no Safari chrome, and a splash screen.
 * See https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios.
 *
 * The two platforms could not be less alike about it:
 *
 *   - Android/Chrome fires `beforeinstallprompt`, which we can hold and replay
 *     as a one-tap install button.
 *   - iOS has no API at all. The only route is the Share sheet, so the only
 *     thing we can do is show the user where it is. That is why this file is
 *     mostly user-agent sniffing — there is no feature to detect.
 *
 * Everything here is browser-only and guarded for SSR, so it can be imported
 * from a module scope that also runs on the server.
 */

export type InstallPlatform =
  /** iOS Safari: the Share sheet has "Add to Home Screen". Show instructions. */
  | "ios-safari"
  /**
   * iOS, but a browser whose Share sheet either lacks the item or hides it
   * somewhere else — Chrome, Firefox, or an in-app webview (a link opened from
   * Instagram or Slack). The user has to reopen the page in Safari first.
   */
  | "ios-other-browser"
  /** Chromium on Android: `beforeinstallprompt` gives us a real install button. */
  | "android"
  /** Desktop, an already-installed app, or the native shell. Show nothing. */
  | "none";

/** Chromium's install event. Not in lib.dom, so it's declared here. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Set once the user has chosen "Not now", so the step is a one-time thing. */
const DISMISSED_KEY = "rg:install-prompt-dismissed";

/**
 * True when the page is already running as an installed app rather than in a
 * browser tab — either a Home Screen launch or the Capacitor shell.
 *
 * `navigator.standalone` is the iOS-only signal and predates `display-mode`;
 * iOS only started reporting the media query correctly in 16.4, and we still
 * support older, so both are checked.
 */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;

  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  if (capacitor?.isNativePlatform?.() === true) return true;

  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;

  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPadOS 13+ reports itself as a Mac; touch points are what give it away. */
function isIos(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * Browsers on iOS that are not Safari. All of them put "Safari" in their user
 * agent — they are all WebKit underneath — so the only way to tell is to look
 * for their own token.
 *
 * The in-app webviews matter more than the alternative browsers do: a link
 * shared to Instagram or Slack opens in one, and its share sheet has no
 * "Add to Home Screen" at all.
 */
const NON_SAFARI_IOS = /crios|fxios|edgios|opios|fban|fbav|instagram|line\/|micromessenger/i;

/**
 * Which install story applies to this browser, if any.
 *
 * Deliberately returns "none" on desktop. Chromium can install there, but a
 * Home Screen icon is a phone affordance and this app is a phone app — a
 * full-screen install step on a laptop would just be in the way.
 */
export function detectInstallPlatform(): InstallPlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "none";
  }
  if (isInstalled()) return "none";

  const ua = navigator.userAgent;
  const platform = navigator.platform ?? "";
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;

  if (isIos(ua, platform, maxTouchPoints)) {
    return NON_SAFARI_IOS.test(ua) ? "ios-other-browser" : "ios-safari";
  }

  if (/android/i.test(ua)) return "android";

  return "none";
}

/**
 * Which edge of the screen Safari's toolbar — and so its Share button — is on,
 * so the step can point at it rather than describe it.
 *
 * iPhone puts it at the bottom, iPad at the top. This is a good guess, not a
 * fact: an iPhone set to the "Single Tab" layout moves the bar to the top, and
 * nothing exposes that to a page. The copy alongside the pointer therefore says
 * "in Safari's toolbar" and never "below", so it still reads correctly for the
 * minority the arrow points the wrong way for.
 */
export function safariToolbarEdge(): "top" | "bottom" {
  if (typeof navigator === "undefined") return "bottom";
  return /ipad/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1)
    ? "top"
    : "bottom";
}

/**
 * Whether the step has been turned down before.
 *
 * Storage access throws outright in some embedded webviews, and a browser that
 * won't remember the dismissal is not a reason to fail — treat it as "not
 * dismissed" and let the user close it again.
 */
export function isInstallPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Nothing to recover: the step is dismissed for this page view either way.
  }
}

/** Only used by tests and the "show me again" path in the You tab. */
export function resetInstallPrompt(): void {
  try {
    window.localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // See above.
  }
}
