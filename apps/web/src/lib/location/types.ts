import type { LngLat } from "@/lib/geo";

/**
 * One position fix, normalised across every platform we track runs on.
 *
 * `timestampMs` is when the *device fixed the position*, not when our callback
 * ran. That distinction is the whole reason this type exists. A browser's
 * `watchPosition` delivers fixes as they happen, so the two are interchangeable
 * there — but a native background tracker does not. When iOS suspends the app
 * mid-run it buffers locations and hands the whole batch over on resume, so a
 * dozen fixes spanning four minutes can arrive in the same millisecond. Timing
 * those by arrival collapses them onto one instant, which reads to the pace
 * maths as a runner covering 800 m instantaneously and gets the whole batch
 * thrown out by the teleport guard.
 */
export type LocationFix = {
  coord: LngLat;
  /** Horizontal accuracy in metres. Larger is worse. */
  accuracyM: number;
  /** Epoch milliseconds, from the platform's own clock. */
  timestampMs: number;
};

/**
 * Why a source stopped producing fixes. The source classifies; the UI owns the
 * wording, so a native permission prompt and a browser one can read differently
 * without the source knowing anything about copy.
 */
export type LocationErrorKind =
  /** The runner said no, or Settings has location off for the app. */
  | "permission-denied"
  /** No location hardware/API at all — this device can never track. */
  | "unsupported"
  /** Transient: no signal yet, indoors, still acquiring. Usually recovers. */
  | "unavailable";

export type LocationError = {
  kind: LocationErrorKind;
  /** Platform detail, for logs — never shown to the runner verbatim. */
  detail?: string;
};

export type LocationHandlers = {
  onFix: (fix: LocationFix) => void;
  onError: (error: LocationError) => void;
};

/**
 * A stream of position fixes.
 *
 * Implementations must tolerate `stop()` being called before `start()` resolves
 * and being called twice — the tracker unmounts on a route change mid-acquire
 * more often than you'd think.
 */
export type LocationSource = {
  /** Human-readable id for diagnostics: "web", "simulated", "native". */
  readonly kind: string;
  /**
   * Whether this source keeps producing fixes while the screen is locked or
   * the app is backgrounded. False for every web source — the browser is
   * suspended and there is no API that changes that. The tracker uses this to
   * decide whether it needs a screen wake lock.
   */
  readonly tracksInBackground: boolean;
  start(handlers: LocationHandlers): Promise<void>;
  stop(): Promise<void>;
};
