import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationError, LocationFix } from "./types";

/**
 * `registerPlugin` runs at module load, so the mock has to exist before the
 * import below is evaluated — hence hoisted.
 */
const plugin = vi.hoisted(() => ({
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(),
  openSettings: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ registerPlugin: () => plugin }));

const { createNativeLocationSource } = await import("./native-source");

/** Runs `start` and hands back whatever the plugin was given as its callback. */
async function startAndCapture(handlers: {
  onFix?: (f: LocationFix) => void;
  onError?: (e: LocationError) => void;
}) {
  let callback!: (position?: unknown, error?: unknown) => void;
  plugin.addWatcher.mockImplementation(async (_opts: unknown, cb: typeof callback) => {
    callback = cb;
    return "watcher-1";
  });

  const source = createNativeLocationSource();
  await source.start({
    onFix: handlers.onFix ?? (() => {}),
    onError: handlers.onError ?? (() => {}),
  });
  return { source, callback };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("createNativeLocationSource", () => {
  it("declares itself as tracking in the background", () => {
    expect(createNativeLocationSource().tracksInBackground).toBe(true);
  });

  it("sets backgroundMessage, without which the plugin is foreground-only", async () => {
    await startAndCapture({});
    const [options] = plugin.addWatcher.mock.calls[0];
    expect(options.backgroundMessage).toBeTruthy();
    // A cached fix at the start line would be counted as real distance.
    expect(options.stale).toBe(false);
  });

  it("maps a plugin location onto a LocationFix, preferring the device clock", async () => {
    const fixes: LocationFix[] = [];
    const { callback } = await startAndCapture({ onFix: (f) => fixes.push(f) });

    callback({ latitude: 51.5, longitude: -0.12, accuracy: 8, time: 1_700_000_000_000 });

    expect(fixes[0]).toEqual({
      coord: [-0.12, 51.5],
      accuracyM: 8,
      timestampMs: 1_700_000_000_000,
    });
  });

  it("falls back to now when the platform omits a fix time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const fixes: LocationFix[] = [];
    const { callback } = await startAndCapture({ onFix: (f) => fixes.push(f) });

    callback({ latitude: 1, longitude: 2, accuracy: 5, time: null });

    expect(fixes[0].timestampMs).toBe(Date.parse("2026-07-28T12:00:00Z"));
  });

  it("preserves buffered ordering so a resumed batch keeps its real timings", async () => {
    const fixes: LocationFix[] = [];
    const { callback } = await startAndCapture({ onFix: (f) => fixes.push(f) });

    // What iOS hands over on resume: several minutes of run, all at once.
    for (const time of [1_000, 61_000, 121_000]) {
      callback({ latitude: 0, longitude: time / 1e6, accuracy: 6, time });
    }

    expect(fixes.map((f) => f.timestampMs)).toEqual([1_000, 61_000, 121_000]);
  });

  it("separates a denied permission from a transient signal loss", async () => {
    const errors: LocationError[] = [];
    const { callback } = await startAndCapture({ onError: (e) => errors.push(e) });

    callback(undefined, Object.assign(new Error("nope"), { code: "NOT_AUTHORIZED" }));
    callback(undefined, Object.assign(new Error("no signal"), { code: "OTHER" }));

    expect(errors.map((e) => e.kind)).toEqual(["permission-denied", "unavailable"]);
  });

  it("reports a rejected addWatcher instead of silently never producing fixes", async () => {
    plugin.addWatcher.mockRejectedValueOnce(new Error("plugin unavailable"));
    const errors: LocationError[] = [];

    await createNativeLocationSource().start({
      onFix: () => {},
      onError: (e) => errors.push(e),
    });

    expect(errors).toEqual([{ kind: "unavailable", detail: "plugin unavailable" }]);
  });

  it("tears down a watcher that resolved after stop() was called", async () => {
    let resolveWatcher!: (id: string) => void;
    plugin.addWatcher.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveWatcher = resolve;
      }),
    );

    const source = createNativeLocationSource();
    const starting = source.start({ onFix: () => {}, onError: () => {} });
    // Tracker unmounts mid-acquire, before the native side has answered.
    await source.stop();
    resolveWatcher("late-watcher");
    await starting;

    expect(plugin.removeWatcher).toHaveBeenCalledWith({ id: "late-watcher" });
  });

  it("removes the watcher once, even on a double stop", async () => {
    const { source } = await startAndCapture({});
    await source.stop();
    await source.stop();
    expect(plugin.removeWatcher).toHaveBeenCalledTimes(1);
  });

  it("swallows a removeWatcher failure so it can't surface over the finish screen", async () => {
    plugin.removeWatcher.mockRejectedValueOnce(new Error("already gone"));
    const { source } = await startAndCapture({});
    await expect(source.stop()).resolves.toBeUndefined();
  });
});
