"use client";

import { useEffect, useRef } from "react";
import { resolveInkRgb, onThemeChange } from "@/lib/canvasInk";

/*
 * The Trifekta mark: three contour peaks - center summit tallest, flanks
 * lower - a 1-2-3 podium drawn as terrain. Same topo language as
 * AsciiContour, reduced to an emblem. Each ridge breathes slightly out of
 * phase with the others. Canvas is tiny (<= 32px), redraws at ~15fps,
 * freezes under prefers-reduced-motion, and picks up theme ink live.
 */

interface Peak {
  apexX: number;
  apexY: number; // resting apex height (0 = top of canvas, 1 = bottom)
  baseL: number;
  baseR: number;
  phase: number; // breathing offset so the three don't move in lockstep
}

const BASE_Y = 0.84;
const PEAKS: Peak[] = [
  { apexX: 0.27, apexY: 0.4, baseL: 0.02, baseR: 0.52, phase: 0.0 }, // left - second place
  { apexX: 0.5, apexY: 0.14, baseL: 0.24, baseR: 0.76, phase: 2.1 }, // center - the winner
  { apexX: 0.74, apexY: 0.5, baseL: 0.5, baseR: 0.98, phase: 4.2 }, // right - third
];

export default function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const px = (u: number) => u * size;

    const draw = (t: number) => {
      const ink = resolveInkRgb(canvas);
      ctx.clearRect(0, 0, size, size);
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Left and right ridges first, center last so the winner overlaps.
      for (const peak of [PEAKS[0], PEAKS[2], PEAKS[1]]) {
        const bob = Math.sin(t * 0.8 + peak.phase) * 0.015;
        const ax = px(peak.apexX);
        const ay = px(peak.apexY + bob);
        const by = px(BASE_Y);

        // Main ridge.
        ctx.beginPath();
        ctx.moveTo(px(peak.baseL), by);
        ctx.lineTo(ax, ay);
        ctx.lineTo(px(peak.baseR), by);
        ctx.strokeStyle = `rgba(${ink}, 0.95)`;
        ctx.stroke();

        // One inner contour under the apex - the topo signature.
        const f = 0.45; // fraction of the way down from apex to base
        ctx.beginPath();
        ctx.moveTo(ax - (ax - px(peak.baseL)) * f, ay + (by - ay) * f);
        ctx.lineTo(ax, ay + (by - ay) * (f * 0.55));
        ctx.lineTo(ax + (px(peak.baseR) - ax) * f, ay + (by - ay) * f);
        ctx.strokeStyle = `rgba(${ink}, 0.4)`;
        ctx.stroke();
      }

      // Baseline grounds the range.
      ctx.beginPath();
      ctx.moveTo(px(0.02), px(BASE_Y));
      ctx.lineTo(px(0.98), px(BASE_Y));
      ctx.strokeStyle = `rgba(${ink}, 0.3)`;
      ctx.stroke();
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(1.3);
      return onThemeChange(() => draw(1.3));
    }

    let raf = 0;
    let last = 0;
    const step = (ms: number) => {
      raf = requestAnimationFrame(step);
      if (ms - last < 66) return; // ~15fps
      last = ms;
      draw(ms / 1000);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />
  );
}
