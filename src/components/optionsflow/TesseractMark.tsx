"use client";

/**
 * The tesseract as the app's working spinner: a real 4D hypercube (16
 * vertices, 32 edges) under a continuous SO(4) double rotation, perspective-
 * projected 4D -> 3D -> 2D and drawn as crisp hairline wireframe. It turns
 * wherever the terminal is working - the loading skeleton and the deep-sync
 * placeholders - and nowhere else (a full-page ambient version read as
 * awkward, and a corner emblem as out of place; motion belongs where the
 * user expects motion). Every frame is computed - no keyframe loop, nothing
 * ever visibly resets. Reduced motion gets a static frame; hidden tabs idle.
 */

import { useEffect, useRef } from "react";

// Gentle perspective (cameras pulled back) so a tumbling corner never
// swells past its canvas and clips.
const D4 = 3.6; // 4D -> 3D camera distance
const D3 = 4.2; // 3D -> 2D camera distance

const VERTS: [number, number, number, number][] = Array.from({ length: 16 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const EDGES: [number, number][] = [];
for (let a = 0; a < 16; a++) {
  for (let b = a + 1; b < 16; b++) {
    const diff = a ^ b;
    if ((diff & (diff - 1)) === 0) EDGES.push([a, b]);
  }
}
const isWEdge = (a: number, b: number) => (a ^ b) === 8; // binds inner cube to outer

interface Projected {
  x: number;
  y: number;
  z: number;
}

/** Double rotation at incommensurate rates (XW/YZ/ZW) - the tumble never repeats - then 4D -> 3D -> 2D perspective. */
function projectVerts(t: number, cx: number, cy: number, scale: number): Projected[] {
  const c1 = Math.cos(t * 0.9), s1 = Math.sin(t * 0.9);
  const c2 = Math.cos(t * 0.61), s2 = Math.sin(t * 0.61);
  const c3 = Math.cos(t * 0.37), s3 = Math.sin(t * 0.37);
  return VERTS.map(([x0, y0, z0, w0]) => {
    let x = x0 * c1 - w0 * s1;
    let w = x0 * s1 + w0 * c1;
    let y = y0 * c2 - z0 * s2;
    let z = y0 * s2 + z0 * c2;
    const z2 = z * c3 - w * s3;
    w = z * s3 + w * c3;
    z = z2;
    const k4 = D4 / (D4 - w * 0.55);
    x *= k4;
    y *= k4;
    z *= k4;
    const k3 = D3 / (D3 - z * 0.45);
    return { x: cx + x * k3 * scale, y: cy + y * k3 * scale, z };
  });
}

/** Canvas needs concrete colors - resolve "var(--x)" tokens against the live theme. */
function resolveColor(c: string | undefined, fallback: string): string {
  if (!c) return fallback;
  const m = c.match(/^var\((--[\w-]+)\)$/);
  if (!m) return c;
  const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return v || fallback;
}

/** The working spinner for loading / deep-sync states. */
export function TesseractMark({ size = 150 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tRef = useRef(0.7);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ink = resolveColor("var(--text)", "#f4f4f5");
    const accent = resolveColor("var(--accent)", ink);

    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (!W || !H) return;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const proj = projectVerts(tRef.current, W / 2, H / 2, Math.min(W, H) * 0.21);

      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      for (const [a, b] of EDGES) {
        const A = proj[a];
        const B = proj[b];
        const depth = (A.z + B.z) / 2;
        const alpha = Math.max(0.22, Math.min(0.95, 0.58 + depth * 0.3));
        ctx.strokeStyle = isWEdge(a, b) ? accent : ink;
        ctx.globalAlpha = isWEdge(a, b) ? alpha : alpha * 0.8;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const p of proj) {
        ctx.fillStyle = ink;
        ctx.globalAlpha = Math.max(0.35, Math.min(1, 0.65 + p.z * 0.3));
        ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      draw();
      return;
    }

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !canvas.offsetParent) return;
      tRef.current += 0.009;
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />;
}
