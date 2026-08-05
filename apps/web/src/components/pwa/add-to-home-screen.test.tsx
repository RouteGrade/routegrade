// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInstallPromptDismissed } from "@/lib/pwa/install";
import { AddToHomeScreenStep } from "./add-to-home-screen";

/**
 * The install step is the first screen a new visitor meets, so the thing worth
 * pinning down is when it stays out of the way: on desktop, in the native
 * shell, once the app is installed, and forever after it's turned down once.
 *
 * See `src/lib/pwa/install.test.ts` for why the globals have to be built by
 * hand — jsdom provides none of them.
 */

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
  standalone = false,
}: {
  ua: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  defineOn(navigator, { userAgent: ua, platform, maxTouchPoints, standalone });
  defineOn(window, { matchMedia: () => ({ matches: false }) });
}

beforeEach(() => {
  defineOn(window, { localStorage: memoryStorage() });
});

afterEach(() => {
  cleanup();
  for (const key of ["userAgent", "platform", "maxTouchPoints", "standalone"]) {
    delete (navigator as unknown as Record<string, unknown>)[key];
  }
  for (const key of ["Capacitor", "matchMedia", "localStorage"]) {
    delete (window as unknown as Record<string, unknown>)[key];
  }
});

describe("AddToHomeScreenStep", () => {
  it("walks an iPhone Safari visitor through the Share sheet", () => {
    browser({ ua: IPHONE_SAFARI });
    render(<AddToHomeScreenStep />);

    expect(
      screen.getByRole("heading", { name: /home screen/i }),
    ).toBeDefined();
    expect(screen.getByText("Add to Home Screen")).toBeDefined();
    expect(screen.getByText("Share")).toBeDefined();
  });

  it("sends an in-app browser to Safari, with the link to carry over", () => {
    browser({ ua: IPHONE_INSTAGRAM });
    render(<AddToHomeScreenStep />);

    expect(screen.getByText("Safari")).toBeDefined();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDefined();
  });

  it("stays out of the way on desktop", () => {
    browser({ ua: MAC_CHROME, platform: "MacIntel", maxTouchPoints: 0 });
    const { container } = render(<AddToHomeScreenStep />);
    expect(container.firstChild).toBeNull();
  });

  it("never appears once the app is already installed", () => {
    browser({ ua: IPHONE_SAFARI, standalone: true });
    const { container } = render(<AddToHomeScreenStep />);
    expect(container.firstChild).toBeNull();
  });

  it("never appears inside the native shell", () => {
    browser({ ua: IPHONE_SAFARI });
    defineOn(window, { Capacitor: { isNativePlatform: () => true } });
    const { container } = render(<AddToHomeScreenStep />);
    expect(container.firstChild).toBeNull();
  });

  it("remembers being turned down, so it is a one-time step", () => {
    browser({ ua: IPHONE_SAFARI });
    const { container, unmount } = render(<AddToHomeScreenStep />);

    fireEvent.click(screen.getByRole("button", { name: /continue in the browser/i }));
    expect(container.firstChild).toBeNull();
    expect(isInstallPromptDismissed()).toBe(true);

    // The real test of "one-time": a fresh mount, as on the next page load.
    unmount();
    const remount = render(<AddToHomeScreenStep />);
    expect(remount.container.firstChild).toBeNull();
  });

  it("ignores the dismissal when reopened deliberately from the You tab", () => {
    browser({ ua: IPHONE_SAFARI });
    render(<AddToHomeScreenStep />);
    fireEvent.click(screen.getByRole("button", { name: /continue in the browser/i }));
    cleanup();

    render(<AddToHomeScreenStep open onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: /home screen/i })).toBeDefined();
    // Closing a deliberately reopened panel is just closing — it must not be
    // able to re-arm or clear the one-time flag.
    expect(screen.getByRole("button", { name: "Done" })).toBeDefined();
  });
});
