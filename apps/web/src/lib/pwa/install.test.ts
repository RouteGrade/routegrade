// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectInstallPlatform,
  dismissInstallPrompt,
  isInstalled,
  isInstallPromptDismissed,
  resetInstallPrompt,
} from "./install";

/**
 * Nothing this module reads exists by default here: jsdom ships no
 * `matchMedia`, no `localStorage`, and no `navigator.maxTouchPoints`, and its
 * user agent claims to be jsdom on darwin. So every test states outright which
 * browser it is describing, and the fixtures below install the globals.
 *
 * That absence is itself worth knowing: it is the same shape as a locked-down
 * webview, and the reason the module optional-chains `matchMedia` and wraps
 * every storage access.
 */

function defineOn(target: object, props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(target, key, { value, configurable: true });
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function browser({
  ua,
  platform = "iPhone",
  maxTouchPoints = 5,
  displayMode = "browser",
  standalone,
  capacitor = false,
}: {
  ua: string;
  platform?: string;
  maxTouchPoints?: number;
  displayMode?: "browser" | "standalone";
  standalone?: boolean;
  capacitor?: boolean;
}) {
  defineOn(navigator, { userAgent: ua, platform, maxTouchPoints });
  if (standalone !== undefined) defineOn(navigator, { standalone });

  defineOn(window, {
    matchMedia: (query: string) => ({
      matches: query.includes("standalone") && displayMode === "standalone",
    }),
  });

  if (capacitor) {
    defineOn(window, { Capacitor: { isNativePlatform: () => true } });
  }
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0";
const IPAD_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

beforeEach(() => {
  defineOn(window, { localStorage: memoryStorage() });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ["userAgent", "platform", "maxTouchPoints", "standalone"]) {
    delete (navigator as unknown as Record<string, unknown>)[key];
  }
  for (const key of ["Capacitor", "matchMedia", "localStorage"]) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
});

describe("detectInstallPlatform", () => {
  it("offers Share-sheet instructions in iPhone Safari", () => {
    browser({ ua: IPHONE_SAFARI });
    expect(detectInstallPlatform()).toBe("ios-safari");
  });

  it("treats iPadOS as iOS even though it claims to be a Mac", () => {
    // Its user agent is indistinguishable from desktop Safari's; the touch
    // points are the only tell, and this breaks if that check is dropped.
    browser({ ua: IPAD_SAFARI, platform: "MacIntel", maxTouchPoints: 5 });
    expect(detectInstallPlatform()).toBe("ios-safari");
  });

  it.each([
    ["Chrome", IPHONE_CHROME],
    ["the Instagram in-app browser", IPHONE_INSTAGRAM],
  ])("sends the visitor to Safari from %s on iOS", (_name, ua) => {
    // Every iOS browser is WebKit underneath and says "Safari" in its UA, so
    // this only works by matching each browser's own token.
    browser({ ua });
    expect(detectInstallPlatform()).toBe("ios-other-browser");
  });

  it("uses the install-event path on Android", () => {
    browser({ ua: ANDROID_CHROME, platform: "Linux armv8l" });
    expect(detectInstallPlatform()).toBe("android");
  });

  it("shows nothing on desktop", () => {
    browser({ ua: MAC_CHROME, platform: "MacIntel", maxTouchPoints: 0 });
    expect(detectInstallPlatform()).toBe("none");
  });

  it("shows nothing once launched from the Home Screen", () => {
    browser({ ua: IPHONE_SAFARI, standalone: true });
    expect(detectInstallPlatform()).toBe("none");
  });

  it("shows nothing inside the native shell", () => {
    browser({ ua: IPHONE_SAFARI, capacitor: true });
    expect(detectInstallPlatform()).toBe("none");
  });

  it("survives a browser with no matchMedia at all", () => {
    // Exactly the environment this test file runs in by default.
    defineOn(navigator, { userAgent: IPHONE_SAFARI, platform: "iPhone" });
    expect(() => detectInstallPlatform()).not.toThrow();
    expect(detectInstallPlatform()).toBe("ios-safari");
  });
});

describe("isInstalled", () => {
  it("trusts display-mode, which is what iOS 16.4+ reports", () => {
    browser({ ua: IPHONE_SAFARI, displayMode: "standalone" });
    expect(isInstalled()).toBe(true);
  });

  it("falls back to navigator.standalone for older iOS", () => {
    browser({ ua: IPHONE_SAFARI, displayMode: "browser", standalone: true });
    expect(isInstalled()).toBe(true);
  });

  it("is false in a plain browser tab", () => {
    browser({ ua: IPHONE_SAFARI, displayMode: "browser", standalone: false });
    expect(isInstalled()).toBe(false);
  });
});

describe("dismissal", () => {
  it("remembers a dismissal, and can be undone", () => {
    expect(isInstallPromptDismissed()).toBe(false);
    dismissInstallPrompt();
    expect(isInstallPromptDismissed()).toBe(true);
    resetInstallPrompt();
    expect(isInstallPromptDismissed()).toBe(false);
  });

  it("treats unreachable storage as not dismissed rather than throwing", () => {
    // Embedded webviews and Safari's stricter privacy modes throw on access
    // instead of returning null.
    defineOn(window, {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });

    expect(isInstallPromptDismissed()).toBe(false);
    expect(() => dismissInstallPrompt()).not.toThrow();
    expect(() => resetInstallPrompt()).not.toThrow();
  });
});
