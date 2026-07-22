"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildShareText,
  deriveReasons,
  GRADE_META,
  type Reason,
  type ScorecardRoute,
} from "@/lib/scorecard";

/**
 * Animated, shareable scorecard for a route: its letter grade plus a few
 * plain-language reasons. PRIVATE BY DEFAULT — this only renders when the user
 * explicitly opens it, and sharing is a further explicit tap. The card and the
 * generated image deliberately contain no map, GPS trace, coordinates, or
 * starting address — only the grade, score, generic reasons, and route name.
 */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Ease a number from 0 to `target` over `durationMs`, respecting reduced motion. */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    // Reduced motion collapses the animation to a single async frame — no
    // synchronous setState in the effect body.
    const effectiveDuration = prefersReducedMotion() ? 0 : durationMs;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = effectiveDuration <= 0 ? 1 : Math.min(1, (now - start) / effectiveDuration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

const REASON_ICON: Record<Reason["key"], React.ReactNode> = {
  flat: (
    <path d="M2 12h20M2 7h20M2 17h20" />
  ),
  hilly: <path d="m3 18 6-9 4 5 3-4 5 8" />,
  quiet: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </>
  ),
  busy: (
    <>
      <path d="M12 2v20M2 12h20" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sidewalks: <path d="M4 22 8 2h2l-1 20M20 22 16 2h-2l1 20M9 12h6" />,
  distance: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
};

/** Draw the scorecard to a PNG blob for sharing/downloading (no location data). */
async function renderImage(
  route: ScorecardRoute,
  reasons: Reason[],
): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const meta = GRADE_META[route.grade];

  // Background
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.34, 60, W / 2, H * 0.34, 560);
  glow.addColorStop(0, `${meta.hexFrom}22`);
  glow.addColorStop(1, "#09090b00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";

  // Wordmark
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText("R O U T E G R A D E", W / 2, 130);

  // Grade letter in a gradient
  const gradeGrad = ctx.createLinearGradient(W / 2 - 200, 260, W / 2 + 200, 560);
  gradeGrad.addColorStop(0, meta.hexFrom);
  gradeGrad.addColorStop(1, meta.hexTo);
  ctx.fillStyle = gradeGrad;
  ctx.font = "800 420px system-ui, sans-serif";
  ctx.fillText(route.grade, W / 2, 590);

  // Score + label
  ctx.fillStyle = "#fafafa";
  ctx.font = "700 64px system-ui, sans-serif";
  ctx.fillText(`${Math.round(route.score)}/100`, W / 2, 700);
  ctx.fillStyle = "#71717a";
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText(meta.label.toUpperCase(), W / 2, 752);

  // Route name
  ctx.fillStyle = "#e4e4e7";
  ctx.font = "600 40px system-ui, sans-serif";
  ctx.fillText(route.name, W / 2, 840);

  // Reasons as pills
  ctx.font = "600 38px system-ui, sans-serif";
  let y = 950;
  for (const reason of reasons.slice(0, 4)) {
    const text = reason.text;
    const textW = ctx.measureText(text).width;
    const padX = 44;
    const pillW = textW + padX * 2;
    const pillH = 82;
    const x = (W - pillW) / 2;
    ctx.fillStyle = "#ffffff12";
    const r = pillH / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + pillW, y, x + pillW, y + pillH, r);
    ctx.arcTo(x + pillW, y + pillH, x, y + pillH, r);
    ctx.arcTo(x, y + pillH, x, y, r);
    ctx.arcTo(x, y, x + pillW, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fafafa";
    ctx.fillText(text, W / 2, y + 54);
    y += pillH + 24;
  }

  // Footer
  ctx.fillStyle = "#52525b";
  ctx.font = "500 30px system-ui, sans-serif";
  ctx.fillText("Graded by RouteGrade", W / 2, H - 70);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

type ShareState = "idle" | "working" | "shared" | "copied" | "error";

export function RouteScorecard({
  route,
  onClose,
}: {
  route: ScorecardRoute;
  onClose: () => void;
}) {
  const reasons = useMemo(() => deriveReasons(route), [route]);
  const meta = GRADE_META[route.grade];
  const score = useCountUp(route.score);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleShare = async () => {
    setShareState("working");
    const text = buildShareText(route);
    try {
      const blob = await renderImage(route, reasons);
      const file = blob
        ? new File([blob], "routegrade-scorecard.png", { type: "image/png" })
        : null;
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      if (file && nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ text, files: [file] } as ShareData);
        setShareState("shared");
        return;
      }
      if (navigator.share) {
        await navigator.share({ text });
        setShareState("shared");
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareState("copied");
    } catch (err) {
      // AbortError = user dismissed the share sheet; not an error.
      if (err instanceof DOMException && err.name === "AbortError") {
        setShareState("idle");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    }
  };

  const handleDownload = async () => {
    setShareState("working");
    try {
      const blob = await renderImage(route, reasons);
      if (!blob) throw new Error("no blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "routegrade-scorecard.png";
      a.click();
      URL.revokeObjectURL(url);
      setShareState("idle");
    } catch {
      setShareState("error");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Route scorecard"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-float-in relative w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close scorecard"
          className="absolute -top-2 -right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-300 shadow-lg transition hover:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* The card */}
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/70">
          <div
            className={`relative bg-linear-to-br ${meta.from} ${meta.to} px-6 pb-8 pt-7`}
          >
            <div className="scorecard-sheen pointer-events-none absolute inset-0" />
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-zinc-950/70">
              RouteGrade
            </p>
            <div className="mt-1 flex items-center justify-center">
              <span className="scorecard-grade font-display text-[7rem] font-extrabold leading-none text-zinc-950">
                {route.grade}
              </span>
            </div>
            <p className="text-center font-display text-2xl font-bold tabular-nums text-zinc-950">
              {Math.round(score)}
              <span className="text-lg font-semibold text-zinc-950/70">/100</span>
            </p>
            <p className="mt-0.5 text-center text-xs font-semibold uppercase tracking-widest text-zinc-950/70">
              {meta.label}
            </p>
          </div>

          <div className="px-6 py-5">
            <h2 className="truncate text-center font-display text-base font-bold text-white">
              {route.name}
            </h2>
            <ul className="mt-4 flex flex-col gap-2">
              {reasons.map((reason, i) => (
                <li
                  key={`${reason.key}-${i}`}
                  className="scorecard-reason flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5"
                  style={{ animationDelay: `${250 + i * 90}ms` }}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br ${meta.from} ${meta.to} text-zinc-950`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      {REASON_ICON[reason.key]}
                    </svg>
                  </span>
                  <span className="text-sm font-medium text-zinc-200">
                    {reason.text}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={handleShare}
                disabled={shareState === "working"}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <path d="M16 6l-4-4-4 4M12 2v13" />
                </svg>
                {shareState === "shared"
                  ? "Shared"
                  : shareState === "copied"
                    ? "Copied"
                    : "Share"}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={shareState === "working"}
                aria-label="Download scorecard image"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/10 disabled:opacity-70"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                </svg>
              </button>
            </div>
            {shareState === "error" && (
              <p role="alert" className="mt-2 text-center text-xs text-rose-400">
                Couldn&apos;t share. Try the download button instead.
              </p>
            )}
            <p className="mt-2 text-center text-[10px] text-zinc-500">
              Private until you share. No location is included.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
