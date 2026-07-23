"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "@/lib/geo";
import { formatDuration, formatPace } from "@/lib/geo";
import {
  buildShareText,
  deriveReasons,
  GRADE_META,
  type Grade,
  type Reason,
} from "@/lib/scorecard";

/**
 * Animated, shareable run-completion card. The hero of the finish screen: it
 * draws the runner's actual route as glowing line-art, animates it in, and
 * counts up the run's stats — then lets the runner export that animation as a
 * short video (or a still image where video share isn't supported).
 *
 * PRIVACY: the route is drawn as *shape only* — no basemap tiles, street
 * names, coordinates, or start address. The normalized line-art conveys the
 * run's "signature" without a pinpointable map. Nothing is shared until the
 * runner explicitly taps Share/Download.
 */

const CANVAS_W = 1080;
const CANVAS_H = 1350;
/** One animation pass, in ms. The exported video is exactly this long. */
const ANIM_MS = 5000;

export type RunShareData = {
  name: string;
  /** Actual ran trace, falling back to planned geometry upstream. */
  path: LngLat[];
  distanceKm: number;
  durationS: number;
  avgPaceS: number | null;
  grade?: Grade;
  score?: number;
  intersectionsPerKm?: number | null;
  sidewalkCoverage?: number | null;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const FALLBACK_COLORS = { hexFrom: "#34d399", hexTo: "#22d3ee" };

/**
 * Project lng/lat into canvas pixels within `box`, preserving shape. Longitude
 * is scaled by cos(lat) so the line-art isn't horizontally squished, and the
 * path is centered and fit to the box. Returns [] for degenerate input.
 */
function projectPath(
  path: LngLat[],
  box: { x: number; y: number; w: number; h: number },
): Array<[number, number]> {
  if (path.length < 2) return [];
  const meanLat =
    path.reduce((sum, [, lat]) => sum + lat, 0) / path.length;
  const kx = Math.cos((meanLat * Math.PI) / 180) || 1;
  const raw = path.map(([lng, lat]) => [lng * kx, lat] as [number, number]);

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;
  const scale = Math.min(box.w / spanX, box.h / spanY);
  // Center the fitted shape within the box.
  const offX = box.x + (box.w - spanX * scale) / 2;
  const offY = box.y + (box.h - spanY * scale) / 2;

  return raw.map(([x, y]) => [
    offX + (x - minX) * scale,
    // Flip Y: higher latitude is "up" (smaller screen y).
    offY + (maxY - y) * scale,
  ]);
}

/** Cumulative pixel length along the projected path. */
function cumulativeLengths(pts: Array<[number, number]>): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    out.push(out[i - 1] + Math.hypot(dx, dy));
  }
  return out;
}

type Scene = {
  pts: Array<[number, number]>;
  cum: number[];
  total: number;
  colors: { hexFrom: string; hexTo: string };
  reasons: Reason[];
  shareText: string;
};

/** Trace the path up to `frac` of its total length; returns the head point. */
function strokePartial(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  frac: number,
): [number, number] | null {
  const { pts, cum, total } = scene;
  if (pts.length < 2) return null;
  const targetLen = total * clamp01(frac);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  let head = pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= targetLen) {
      ctx.lineTo(pts[i][0], pts[i][1]);
      head = pts[i];
    } else {
      const segLen = cum[i] - cum[i - 1] || 1;
      const t = (targetLen - cum[i - 1]) / segLen;
      const hx = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const hy = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      ctx.lineTo(hx, hy);
      head = [hx, hy];
      break;
    }
  }
  ctx.stroke();
  return head;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the full frame at animation time `ms` (0..ANIM_MS). Pure w.r.t. scene. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  data: RunShareData,
  ms: number,
) {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const u = clamp01(ms / ANIM_MS);
  const { colors } = scene;

  // Background
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.36, 60, W / 2, H * 0.36, 640);
  glow.addColorStop(0, `${colors.hexFrom}26`);
  glow.addColorStop(1, "#09090b00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Wordmark
  ctx.globalAlpha = clamp01(u / 0.06);
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "700 32px system-ui, sans-serif";
  ctx.fillText("R O U T E G R A D E", W / 2, 110);
  ctx.globalAlpha = 1;

  // Route line-art (shape only)
  const drawFrac = easeInOutCubic(clamp01((u - 0.06) / 0.52));
  if (scene.pts.length >= 2 && drawFrac > 0) {
    ctx.save();
    const grad = ctx.createLinearGradient(140, 180, W - 140, 700);
    grad.addColorStop(0, colors.hexFrom);
    grad.addColorStop(1, colors.hexTo);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 16;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = `${colors.hexFrom}aa`;
    ctx.shadowBlur = 32;
    const head = strokePartial(ctx, scene, drawFrac);
    ctx.restore();

    // Start dot
    ctx.fillStyle = "#fafafa";
    ctx.beginPath();
    ctx.arc(scene.pts[0][0], scene.pts[0][1], 12, 0, Math.PI * 2);
    ctx.fill();

    // Moving head dot while drawing
    if (head && drawFrac < 1) {
      ctx.save();
      ctx.shadowColor = colors.hexTo;
      ctx.shadowBlur = 28;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(head[0], head[1], 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Count-up progress for the numeric hero
  const countP = easeOutCubic(clamp01((u - 0.15) / 0.45));

  // Distance headline — number + "km" laid out as one centered group. Measure
  // each token in its own font so the unit never collides with the number.
  const distStr = (data.distanceKm * countP).toFixed(2);
  const numFont = "800 128px system-ui, sans-serif";
  const kmFont = "700 44px system-ui, sans-serif";
  ctx.font = numFont;
  const numW = ctx.measureText(distStr).width;
  ctx.font = kmFont;
  const kmW = ctx.measureText("km").width;
  const unitGap = 16;
  const startX = (W - (numW + unitGap + kmW)) / 2;
  const distBaseline = 850;
  ctx.textAlign = "left";
  ctx.font = numFont;
  ctx.fillStyle = "#fafafa";
  ctx.fillText(distStr, startX, distBaseline);
  ctx.font = kmFont;
  ctx.fillStyle = "#71717a";
  ctx.fillText("km", startX + numW + unitGap, distBaseline);
  ctx.textAlign = "center";

  // Stat chips: Time · Pace · Grade — fade/rise in together
  const chipsAlpha = clamp01((u - 0.3) / 0.2);
  const chips: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: "TIME", value: formatDuration(data.durationS) },
    { label: "AVG PACE", value: `${formatPace(data.avgPaceS)}` },
  ];
  if (data.grade) {
    chips.push({
      label: "GRADE",
      value:
        data.score != null
          ? `${data.grade} · ${Math.round(data.score)}`
          : data.grade,
      accent: true,
    });
  }
  const chipW = 280;
  const chipH = 140;
  const gap = 26;
  const totalW = chips.length * chipW + (chips.length - 1) * gap;
  let cx = (W - totalW) / 2;
  const chipY = 910;
  ctx.globalAlpha = chipsAlpha;
  for (const chip of chips) {
    if (chip.accent) {
      const g = ctx.createLinearGradient(cx, chipY, cx + chipW, chipY + chipH);
      g.addColorStop(0, `${colors.hexFrom}33`);
      g.addColorStop(1, `${colors.hexTo}22`);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "#ffffff0f";
    }
    roundRectPath(ctx, cx, chipY, chipW, chipH, 28);
    ctx.fill();

    ctx.fillStyle = "#8b8b94";
    ctx.font = "600 26px system-ui, sans-serif";
    ctx.fillText(chip.label, cx + chipW / 2, chipY + 50);
    ctx.fillStyle = chip.accent ? colors.hexFrom : "#fafafa";
    ctx.font = "700 54px system-ui, sans-serif";
    ctx.fillText(chip.value, cx + chipW / 2, chipY + 108);
    cx += chipW + gap;
  }
  ctx.globalAlpha = 1;

  // Reason pills, staggered in
  ctx.font = "600 34px system-ui, sans-serif";
  let py = 1095;
  scene.reasons.slice(0, 2).forEach((reason, i) => {
    const a = clamp01((u - (0.58 + i * 0.1)) / 0.14);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const textW = ctx.measureText(reason.text).width;
    const padX = 40;
    const pillW = textW + padX * 2;
    const pillH = 70;
    const x = (W - pillW) / 2;
    ctx.fillStyle = "#ffffff12";
    roundRectPath(ctx, x, py, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = "#e4e4e7";
    ctx.fillText(reason.text, W / 2, py + 47);
    py += pillH + 16;
    ctx.globalAlpha = 1;
  });

  // Footer
  ctx.fillStyle = "#52525b";
  ctx.font = "500 28px system-ui, sans-serif";
  ctx.fillText("Graded by RouteGrade", W / 2, H - 40);
}

/** Pick a supported recording mime and its file extension, or null. */
function pickVideoMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "video/mp4;codecs=avc1", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  return (
    candidates.find((c) => {
      try {
        return MediaRecorder.isTypeSupported(c.mime);
      } catch {
        return false;
      }
    }) ?? null
  );
}

type ExportState = "idle" | "rendering" | "shared" | "saved" | "copied" | "error";

export function RunShareCard({ data }: { data: RunShareData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRafRef = useRef(0);
  const recordingRef = useRef(false);
  const [state, setState] = useState<ExportState>("idle");

  const scene = useMemo<Scene>(() => {
    const box = { x: 130, y: 150, w: CANVAS_W - 260, h: 560 };
    const pts = projectPath(data.path, box);
    const cum = cumulativeLengths(pts);
    const colors =
      data.grade != null
        ? {
            hexFrom: GRADE_META[data.grade].hexFrom,
            hexTo: GRADE_META[data.grade].hexTo,
          }
        : FALLBACK_COLORS;
    const reasons =
      data.grade != null
        ? deriveReasons({
            name: data.name,
            grade: data.grade,
            score: data.score ?? 0,
            distance_km: data.distanceKm,
            elevation_gain_m: 0,
            intersections_per_km: data.intersectionsPerKm ?? null,
            sidewalk_coverage: data.sidewalkCoverage ?? null,
          })
        : [];
    const shareText =
      data.grade != null
        ? buildShareText({
            name: data.name,
            grade: data.grade,
            score: data.score ?? 0,
            distance_km: data.distanceKm,
            elevation_gain_m: 0,
            intersections_per_km: data.intersectionsPerKm ?? null,
            sidewalk_coverage: data.sidewalkCoverage ?? null,
          })
        : `Ran ${data.distanceKm.toFixed(2)} km on RouteGrade.`;
    return { pts, cum, total: cum[cum.length - 1] ?? 0, colors, reasons, shareText };
  }, [data]);

  const paint = useCallback(
    (ms: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawFrame(ctx, scene, data, ms);
    },
    [scene, data],
  );

  // Live preview loop (skipped for reduced motion — show the final frame).
  useEffect(() => {
    if (prefersReducedMotion()) {
      paint(ANIM_MS);
      return;
    }
    const start = performance.now();
    const loop = (now: number) => {
      if (!recordingRef.current) {
        // A short hold at the end before looping, so the full route lingers.
        const elapsed = (now - start) % (ANIM_MS + 1400);
        paint(Math.min(elapsed, ANIM_MS));
      }
      previewRafRef.current = requestAnimationFrame(loop);
    };
    previewRafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(previewRafRef.current);
  }, [paint]);

  /** Record exactly one animation pass to a video blob, or null if unsupported. */
  const recordVideo = useCallback(async (): Promise<
    { blob: Blob; ext: string } | null
  > => {
    const canvas = canvasRef.current;
    const picked = pickVideoMime();
    if (!canvas || !picked || typeof canvas.captureStream !== "function") {
      return null;
    }
    const stream = canvas.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: picked.mime,
        videoBitsPerSecond: 6_000_000,
      });
    } catch {
      return null;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    recordingRef.current = true;
    recorder.start();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        const t = now - start;
        paint(Math.min(t, ANIM_MS));
        if (t < ANIM_MS) {
          requestAnimationFrame(step);
        } else {
          // Hold the final frame briefly so the loop ends on the full route.
          setTimeout(() => {
            recorder.stop();
            resolve();
          }, 500);
        }
      };
      requestAnimationFrame(step);
    });
    await stopped;
    recordingRef.current = false;
    return { blob: new Blob(chunks, { type: picked.mime }), ext: picked.ext };
  }, [paint]);

  /** Render the final frame to a still PNG (universal fallback). */
  const renderStill = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    recordingRef.current = true;
    paint(ANIM_MS);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    recordingRef.current = false;
    return blob;
  }, [paint]);

  const handleShare = useCallback(async () => {
    setState("rendering");
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    try {
      // Try an animated video first.
      const video = await recordVideo();
      if (video && video.blob.size > 0) {
        const file = new File([video.blob], `routegrade-run.${video.ext}`, {
          type: video.blob.type,
        });
        if (nav.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({ text: scene.shareText, files: [file] });
          setState("shared");
          return;
        }
        // Can't share the file natively — download it instead.
        triggerDownload(video.blob, `routegrade-run.${video.ext}`);
        setState("saved");
        return;
      }
      // Fall back to a still image share.
      const still = await renderStill();
      const file = still
        ? new File([still], "routegrade-run.png", { type: "image/png" })
        : null;
      if (file && nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ text: scene.shareText, files: [file] });
        setState("shared");
        return;
      }
      if (navigator.share) {
        await navigator.share({ text: scene.shareText });
        setState("shared");
        return;
      }
      await navigator.clipboard.writeText(scene.shareText);
      setState("copied");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setState("idle");
        return;
      }
      try {
        await navigator.clipboard.writeText(scene.shareText);
        setState("copied");
      } catch {
        setState("error");
      }
    }
  }, [recordVideo, renderStill, scene.shareText]);

  const handleDownload = useCallback(async () => {
    setState("rendering");
    try {
      const video = await recordVideo();
      if (video && video.blob.size > 0) {
        triggerDownload(video.blob, `routegrade-run.${video.ext}`);
        setState("saved");
        return;
      }
      const still = await renderStill();
      if (!still) throw new Error("no image");
      triggerDownload(still, "routegrade-run.png");
      setState("saved");
    } catch {
      setState("error");
    }
  }, [recordVideo, renderStill]);

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block h-auto w-full"
          role="img"
          aria-label={`Run summary: ${data.distanceKm.toFixed(
            2,
          )} km in ${formatDuration(data.durationS)}${
            data.grade ? `, graded ${data.grade}` : ""
          }`}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleShare}
          disabled={state === "rendering"}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-r from-emerald-400 to-cyan-400 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <path d="M16 6l-4-4-4 4M12 2v13" />
          </svg>
          {state === "rendering"
            ? "Preparing…"
            : state === "shared"
              ? "Shared"
              : state === "copied"
                ? "Copied"
                : "Share your run"}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={state === "rendering"}
          aria-label="Download run video"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 transition hover:bg-white/10 disabled:opacity-70"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        </button>
      </div>
      {state === "error" && (
        <p role="alert" className="mt-2 text-center text-xs text-rose-400">
          Couldn&apos;t export. Try the download button instead.
        </p>
      )}
      {state === "saved" && (
        <p className="mt-2 text-center text-xs text-emerald-300">
          Saved to your device.
        </p>
      )}
      <p className="mt-2 text-center text-[10px] text-zinc-500">
        Shape only — no map, address, or coordinates are included.
      </p>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
