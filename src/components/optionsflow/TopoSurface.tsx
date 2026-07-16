"use client";

/**
 * TOPO - market topography. A rotating 3D terrain of the dealer book viewed
 * from a 3/4 elevated camera (like a relief map on a table), ported from the
 * altaris-levels TOPO view - one surface per major Greek (GEX/DEX/VANNA/
 * CHARM/THETA/VEGA) by strike x expiry tenor; peaks = call-side walls,
 * basins = put-side walls (LONG/SHORT for DEX, burn concentration for THETA).
 * Hand-rolled projection (no libraries). The data grid is Catmull-Rom
 * upsampled to a dense display mesh; the terrain renders on a WebGL canvas
 * (raw GL - per-pixel ramp + hillshade interpolation, smooth at any angle)
 * with a 2D canvas layered on top for ticks/labels/legend/hover; a
 * flat-shaded 2D quad painter remains as the no-WebGL fallback. Drag to
 * rotate; hover reads the nearest node. Respects prefers-reduced-motion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { TENOR_LABELS, type TopoRow } from "@/lib/topoProfile";

const ROWS = 16;
const MAX_COLS = 44;
// Display mesh density (data grid is Catmull-Rom upsampled to this - smooth, non-polygonal).
const DROWS = 48;
const DCOLS_MAX = 132;
const CYCLE_MS = 16_000;
const PIN_MS = 45_000;

export type TopoModeId = "gex" | "dex" | "vex" | "cex" | "tex" | "vegaex";

interface TopoMode {
  id: TopoModeId;
  label: string;
  pick: (r: TopoRow) => readonly number[];
  caption: string;
  /** Summit tag suffixes for positive/negative peaks (walls read differently per Greek). */
  posTag: string;
  negTag: string;
}

const MODES: TopoMode[] = [
  { id: "gex", label: "GEX", pick: (r) => r.gex, posTag: "CALL", negTag: "PUT",
    caption: "DEALER GAMMA · strike × expiry — peak = call wall · basin = put wall · dashed line = spot" },
  { id: "dex", label: "DEX", pick: (r) => r.dex, posTag: "LONG", negTag: "SHORT",
    caption: "DEALER DELTA · strike × expiry — natural delta sign, unflipped" },
  { id: "vex", label: "VEX", pick: (r) => r.vanna, posTag: "CALL", negTag: "PUT",
    caption: "VANNA · strike × expiry — where a vol shock forces the biggest re-hedge" },
  { id: "cex", label: "CHEX", pick: (r) => r.charm, posTag: "CALL", negTag: "PUT",
    caption: "TIME-DECAY FLOW · strike × expiry — where charm-driven hedging pulls price into each expiry" },
  { id: "tex", label: "THETA", pick: (r) => r.theta, posTag: "BURN", negTag: "BURN",
    caption: "THETA · strike × expiry — where the book's time decay concentrates" },
  { id: "vegaex", label: "VEGA", pick: (r) => r.vega, posTag: "CALL", negTag: "PUT",
    caption: "VEGA · strike × expiry — IV sensitivity by strike" },
];

/**
 * Color schemes sampled from PUBLISHED scientific colormaps (not hand-rolled).
 * HEAT (default) maps by |value| - put basins and call walls BOTH glow;
 * direction is carried by the geometry (peak vs basin) and the hover readout.
 * The rest are signed diverging maps (cool half = put, warm half = call).
 */
const PALETTES: { id: string; label: string; mag?: boolean; stops: [number, number, number, number][] }[] = [
  { id: "heat", label: "HEAT", mag: true, stops: [
    [0, 45, 7, 64], [0.08, 46, 20, 118], [0.18, 33, 74, 190], [0.3, 32, 130, 205], [0.42, 42, 175, 180], [0.54, 55, 195, 90], [0.66, 170, 218, 50], [0.76, 248, 222, 38], [0.86, 250, 140, 30], [0.94, 240, 45, 25], [1, 200, 10, 20],
  ] },
  { id: "turbo", label: "TURBO", stops: [
    [0, 35, 23, 27], [0.043, 68, 50, 140], [0.087, 75, 79, 208], [0.13, 67, 109, 241], [0.174, 54, 140, 249], [0.217, 43, 168, 240], [0.261, 37, 194, 219], [0.304, 40, 217, 193], [0.348, 51, 234, 165], [0.391, 72, 246, 137], [0.435, 99, 253, 112], [0.478, 131, 253, 90], [0.522, 166, 247, 72], [0.565, 199, 235, 59], [0.609, 227, 217, 49], [0.652, 249, 194, 41], [0.696, 255, 167, 35], [0.739, 255, 138, 31], [0.783, 252, 107, 26], [0.826, 233, 77, 20], [0.87, 206, 50, 13], [0.913, 178, 28, 6], [0.957, 154, 14, 0], [1, 144, 12, 0],
  ] },
  { id: "spectral", label: "SPCTRL", stops: [
    [0, 94, 79, 162], [0.1, 50, 136, 189], [0.2, 102, 194, 165], [0.3, 171, 221, 164], [0.4, 230, 245, 152], [0.5, 255, 255, 191], [0.6, 254, 224, 139], [0.7, 253, 174, 97], [0.8, 244, 109, 67], [0.9, 213, 62, 79], [1, 158, 1, 66],
  ] },
  { id: "oleron", label: "OLERON", stops: [
    [0, 26, 38, 89], [0.045, 43, 56, 107], [0.091, 61, 74, 125], [0.136, 80, 93, 144], [0.181, 100, 113, 164], [0.227, 120, 133, 184], [0.272, 141, 154, 205], [0.318, 162, 175, 225], [0.363, 182, 195, 240], [0.408, 199, 212, 247], [0.454, 214, 227, 251], [0.499, 230, 242, 255], [0.5, 26, 76, 0], [0.545, 55, 85, 0], [0.591, 79, 92, 2], [0.636, 105, 103, 15], [0.682, 131, 119, 40], [0.727, 156, 135, 66], [0.773, 182, 153, 92], [0.818, 208, 173, 119], [0.864, 232, 194, 148], [0.909, 244, 215, 176], [0.955, 249, 234, 202], [1, 253, 253, 230],
  ] },
  { id: "balance", label: "BALANCE", stops: [
    [0, 24, 28, 67], [0.043, 34, 43, 102], [0.087, 41, 58, 140], [0.13, 35, 75, 180], [0.174, 10, 99, 190], [0.217, 34, 121, 187], [0.261, 63, 140, 186], [0.304, 94, 158, 187], [0.348, 128, 175, 192], [0.391, 163, 191, 201], [0.435, 196, 208, 213], [0.478, 227, 227, 228], [0.522, 236, 224, 222], [0.565, 226, 198, 190], [0.609, 218, 173, 158], [0.652, 211, 147, 126], [0.696, 203, 122, 95], [0.739, 194, 96, 66], [0.783, 184, 68, 43], [0.826, 169, 39, 36], [0.87, 147, 18, 40], [0.913, 118, 14, 40], [0.957, 89, 14, 31], [1, 60, 9, 18],
  ] },
];

const PAL_STORAGE_KEY = "yyyTopoPal";

/** Adaptive magnitude formatter - the surface endpoints are unit-proxy values that can range from sub-1 (charm) to billions (gex). */
function fmtMag(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a >= 10 ? a.toFixed(0) : a.toFixed(2)}`;
}

interface Palette {
  ink: string;
  ink2: string;
  ink3: string;
  up: string;
  down: string;
  accent: string;
  paper: string;
}

interface Surface {
  cols: number[];
  h: number[][];
  raw: number[][];
  maxAbs: number;
  RR: number;
  CC: number;
  hd: number[][];
  amp: number;
  floorY: number;
  lam: number[][];
  glPos: Float32Array;
  glT: Float32Array;
  glShade: Float32Array;
  glIdx: Uint16Array;
  glFloor: Float32Array;
}

const hex2rgb = (h: string): [number, number, number] => {
  const m = h.trim().replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [150, 160, 174];
};
const rgbStr = (c: [number, number, number] | number[], k = 1) =>
  `rgb(${Math.round(Math.min(255, Math.max(0, c[0] * k)))},${Math.round(Math.min(255, Math.max(0, c[1] * k)))},${Math.round(Math.min(255, Math.max(0, c[2] * k)))})`;

const cosMix = (a: number, b: number, t: number) => a + (b - a) * (1 - Math.cos(t * Math.PI)) / 2;

// Catmull-Rom spline through the data points: passes exactly through every
// value (peaks stay peaks) but curves smoothly between them.
const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

function resample1d(src: number[], outN: number): number[] {
  const n = src.length;
  const at = (i: number) => src[Math.min(n - 1, Math.max(0, i))];
  return Array.from({ length: outN }, (_, o) => {
    const x = (o / (outN - 1)) * (n - 1);
    const i = Math.floor(x);
    const f = x - i;
    return f === 0 ? at(i) : catmull(at(i - 1), at(i), at(i + 1), at(i + 2), f);
  });
}

function upsampleGrid(h: number[][], outR: number, outC: number): number[][] {
  const wide = h.map((row) => resample1d(row, outC));
  const out: number[][] = Array.from({ length: outR }, () => new Array<number>(outC));
  const col = new Array<number>(h.length);
  for (let c = 0; c < outC; c++) {
    for (let r = 0; r < h.length; r++) col[r] = wide[r][c];
    const sm = resample1d(col, outR);
    for (let r = 0; r < outR; r++) out[r][c] = Math.max(-1.05, Math.min(1.05, sm[r]));
  }
  return out;
}

/** Per-VERTEX lambert shading from central-difference normals on the smooth display mesh (light baked in model space, stable while the terrain turns). */
function lambertGrid(hd: number[][], RR: number, CC: number, AMP: number): number[][] {
  const dx = 2 / (CC - 1);
  const dz = 1.2 / (RR - 1);
  const LX = -0.42, LY = 0.84, LZ = -0.36;
  const LN = Math.hypot(LX, LY, LZ);
  const lam: number[][] = Array.from({ length: RR }, () => new Array<number>(CC));
  for (let r = 0; r < RR; r++) {
    const rl = Math.max(0, r - 1);
    const rh = Math.min(RR - 1, r + 1);
    for (let c = 0; c < CC; c++) {
      const cl = Math.max(0, c - 1);
      const ch = Math.min(CC - 1, c + 1);
      const dhdx = ((hd[r][ch] - hd[r][cl]) * AMP) / ((ch - cl) * dx);
      const dhdz = ((hd[rh][c] - hd[rl][c]) * AMP) / ((rh - rl) * dz);
      const nn = Math.hypot(dhdx, 1, dhdz);
      lam[r][c] = Math.max(0, (-dhdx * LX + LY - dhdz * LZ) / (nn * LN));
    }
  }
  return lam;
}

function subsample(rows: TopoRow[]): TopoRow[] {
  if (rows.length <= MAX_COLS) return rows;
  const step = rows.length / MAX_COLS;
  return Array.from({ length: MAX_COLS }, (_, i) => rows[Math.floor(i * step)]);
}

/** Typed-array mesh for the GL path (positions + ramp coord + shade + triangle indices + floor grid). */
function buildGeometry(S: Omit<Surface, "glPos" | "glT" | "glShade" | "glIdx" | "glFloor">): Pick<Surface, "glPos" | "glT" | "glShade" | "glIdx" | "glFloor"> {
  const { RR, CC, hd, lam, amp, floorY, cols } = S;
  const X = (c: number) => (c / (CC - 1)) * 2 - 1;
  const Z = (r: number) => ((r / (RR - 1)) * 2 - 1) * 0.6;
  const n = RR * CC;
  const pos = new Float32Array(n * 3);
  const tv = new Float32Array(n);
  const sh = new Float32Array(n);
  let i = 0;
  for (let r = 0; r < RR; r++) {
    for (let c = 0; c < CC; c++, i++) {
      pos[i * 3] = X(c);
      pos[i * 3 + 1] = hd[r][c] * amp;
      pos[i * 3 + 2] = Z(r);
      tv[i] = hd[r][c]; // raw normalized value - the SHADER maps it to a ramp coord (uMode)
      sh[i] = 0.62 + 0.38 * lam[r][c];
    }
  }
  const idx = new Uint16Array((RR - 1) * (CC - 1) * 6);
  let j = 0;
  for (let r = 0; r < RR - 1; r++) {
    for (let c = 0; c < CC - 1; c++) {
      const a = r * CC + c;
      const b = a + 1;
      const d = a + CC;
      const e = d + 1;
      idx[j++] = a; idx[j++] = b; idx[j++] = d;
      idx[j++] = b; idx[j++] = e; idx[j++] = d;
    }
  }
  // Floor grid segments, data-spaced like the 2D pass (depth-tested in GL so terrain occludes them).
  const nC = cols.length;
  const dC = (c: number) => (c * (CC - 1)) / (nC - 1);
  const dR = (r: number) => (r * (RR - 1)) / (ROWS - 1);
  const seg: number[] = [];
  for (let c = 0; c < nC; c += 6) seg.push(X(dC(c)), floorY, Z(0), X(dC(c)), floorY, Z(RR - 1));
  for (let r = 0; r < ROWS; r += 5) seg.push(X(0), floorY, Z(dR(r)), X(CC - 1), floorY, Z(dR(r)));
  return { glPos: pos, glT: tv, glShade: sh, glIdx: idx, glFloor: new Float32Array(seg) };
}

function termSurface(profile: TopoRow[], pick: (r: TopoRow) => readonly number[]): Surface | null {
  const rows = subsample(profile);
  if (rows.length < 5) return null;
  const cols = rows.map((r) => r.strike);
  const h: number[][] = [];
  const raw: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const t = (r / (ROWS - 1)) * 3;
    const i = Math.min(2, Math.floor(t));
    const f = t - i;
    // ?? [] guards a stale cached API response that predates a newly added Greek field.
    h.push(rows.map((row) => cosMix((pick(row) ?? [])[i] ?? 0, (pick(row) ?? [])[i + 1] ?? 0, f)));
    raw.push(rows.map((row) => (pick(row) ?? [])[Math.round(t)] ?? 0));
  }
  let maxAbs = 0;
  for (const row of h) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (!(maxAbs > 0)) return null;
  const hn = h.map((row) => row.map((v) => v / maxAbs));
  const CC = Math.min(DCOLS_MAX, (cols.length - 1) * 3 + 1);
  const amp = 0.42;
  const hd = upsampleGrid(hn, DROWS, CC);
  const lam = lambertGrid(hd, DROWS, CC, amp);
  const base = { cols, h: hn, raw, maxAbs, RR: DROWS, CC, hd, amp, floorY: -amp * 1.08, lam };
  return { ...base, ...buildGeometry(base) };
}

const GL_VS = `
attribute vec3 aPos; attribute float aT; attribute float aShade;
uniform vec2 uYaw; uniform vec2 uPit; uniform vec2 uScale; uniform float uF; uniform float uMode;
varying float vT; varying float vShade;
void main() {
  float xr = aPos.x * uYaw.x - aPos.z * uYaw.y;
  float zr = aPos.x * uYaw.y + aPos.z * uYaw.x;
  float yr = aPos.y * uPit.x + zr * uPit.y;
  float z2 = zr * uPit.x - aPos.y * uPit.y;
  float w = (uF + z2) / uF;
  gl_Position = vec4(xr * uScale.x, yr * uScale.y, z2 * 0.2 * w, w);
  // aT is the raw normalized value; 0 = signed full ramp, 2 = magnitude (HEAT,
  // with 0.7 gamma so mid-size walls climb past yellow - keep in sync with tOf).
  vT = uMode < 0.5 ? (clamp(aT, -1.0, 1.0) + 1.0) * 0.5 : pow(min(1.0, abs(aT)), 0.7);
  vShade = aShade;
}`;
const GL_FS = `
precision mediump float;
uniform sampler2D uRamp; uniform float uAlpha; uniform float uFlat; uniform vec3 uFlatColor;
varying float vT; varying float vShade;
void main() {
  vec3 c = mix(texture2D(uRamp, vec2(vT, 0.5)).rgb * vShade, uFlatColor, uFlat);
  gl_FragColor = vec4(c * uAlpha, uAlpha);
}`;

export default function TopoSurface({
  rows,
  spot,
  height = 480,
  tenorLabels = TENOR_LABELS,
  metric,
}: {
  rows: TopoRow[];
  spot: number;
  height?: number;
  tenorLabels?: readonly string[];
  /** When set, the page's global Greek selector drives the surface: the internal metric tabs hide and auto-cycling stops. */
  metric?: TopoModeId;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [modeIdx, setModeIdx] = useState(0);
  // Persisted palette choice - lazy initializer so there's no set-state-in-effect;
  // SSR sees the default (the palette chip carries suppressHydrationWarning for that).
  const [palIdx, setPalIdx] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const saved = localStorage.getItem(PAL_STORAGE_KEY);
      const i = PALETTES.findIndex((p) => p.id === saved);
      return i >= 0 ? i : 0;
    } catch {
      return 0; // private mode
    }
  });
  const [readout, setReadout] = useState("");

  const surfaces = useMemo(() => {
    const out = new Map<TopoModeId, Surface>();
    if (rows.length >= 5) {
      for (const m of MODES) {
        const s = termSurface(rows, m.pick);
        if (s) out.set(m.id, s);
      }
    }
    return out;
  }, [rows]);

  const modeIds = useMemo(() => MODES.filter((m) => surfaces.has(m.id)).map((m) => m.id), [surfaces]);
  // Controlled mode: the external metric wins whenever its surface exists;
  // a missing surface (e.g. a flat Greek in a scenario mode) falls back to
  // whatever is available rather than rendering nothing.
  const controlled = metric !== undefined;
  const externalIdx = controlled ? modeIds.indexOf(metric) : -1;
  const activeIdx = externalIdx >= 0 ? externalIdx : Math.min(modeIdx, Math.max(0, modeIds.length - 1));
  const activeMode = MODES.find((m) => m.id === modeIds[activeIdx]) ?? MODES[0];

  // Mutable view state shared with the imperative render loop.
  const view = useRef({ yaw: 0.62, pitch: 0.52, dragUntil: 0, fadeT: 1, lastCycle: 0, pinnedUntil: 0 });
  const prevIdxRef = useRef(activeIdx);
  const stateRef = useRef({ surfaces, modeIds, modeIdx: activeIdx, palIdx, spot, controlled, tenorLabels });
  useEffect(() => {
    // Snapshot the latest render values for the rAF loop - ref writes belong in effects, not render.
    if (prevIdxRef.current !== activeIdx) {
      prevIdxRef.current = activeIdx;
      view.current.fadeT = 0; // crossfade when the external selector switches the surface
    }
    stateRef.current = { surfaces, modeIds, modeIdx: activeIdx, palIdx, spot, controlled, tenorLabels };
  }, [surfaces, modeIds, activeIdx, palIdx, spot, controlled, tenorLabels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!canvas || !glCanvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let pal: Palette = { ink: "#e8eaed", ink2: "#9aa0a6", ink3: "#6b7280", up: "#22c55e", down: "#ef4444", accent: "#38bdf8", paper: "#101418" };
    // ctx.font cannot resolve CSS var() - resolve the app's mono family once here.
    let monoFam = "ui-monospace, monospace";
    const refreshPalette = () => {
      const s = getComputedStyle(document.documentElement);
      const g = (n: string, fb: string) => {
        const v = s.getPropertyValue(n).trim();
        return v.startsWith("#") ? v : fb;
      };
      pal = {
        ink: g("--text", pal.ink), ink2: g("--text-dim", pal.ink2), ink3: g("--text-faint", pal.ink3),
        up: g("--up", pal.up), down: g("--down", pal.down), accent: g("--accent", pal.accent), paper: g("--panel", pal.paper),
      };
      const fam = s.getPropertyValue("--font-mono").trim();
      if (fam) monoFam = `${fam}, monospace`;
    };
    refreshPalette();

    const ramp = (t: number): [number, number, number] => {
      const stops = PALETTES[stateRef.current.palIdx].stops;
      t = Math.min(1, Math.max(0, t));
      let i = 1;
      while (i < stops.length - 1 && stops[i][0] < t) i++;
      const a = stops[i - 1];
      const b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    };
    /** value → ramp coord. HEAT sweeps the full ramp by |v|^0.7; signed palettes use the full ramp centered at 0.5. */
    const tOf = (v: number) => (PALETTES[stateRef.current.palIdx].mag ? Math.pow(Math.min(1, Math.abs(v)), 0.7) : (Math.max(-1, Math.min(1, v)) + 1) / 2);

    /** Cartographic halo: paper outline under the glyphs so labels stay legible on the wireframe. */
    const label = (str: string, x: number, y: number, color: string) => {
      ctx.strokeStyle = pal.paper;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    };

    // ── WebGL surface renderer (per-pixel ramp/hillshade; 2D quad painter fallback) ──
    let gl: WebGLRenderingContext | null = null;
    let glP: WebGLProgram | null = null;
    let glLoc: Record<string, number | WebGLUniformLocation | null> = {};
    let glBuf: Record<string, WebGLBuffer | null> = {};
    let glTex: WebGLTexture | null = null;
    let glSurf: Surface | null = null;
    let glPalIdx = -1;

    const uploadRampTex = () => {
      if (!gl || !glTex) return;
      const px = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        const c = ramp(i / 255);
        px[i * 4] = Math.round(c[0]);
        px[i * 4 + 1] = Math.round(c[1]);
        px[i * 4 + 2] = Math.round(c[2]);
        px[i * 4 + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      glPalIdx = stateRef.current.palIdx;
    };

    try {
      glCanvas.style.display = ""; // undo a prior fallback-hide (e.g. effect re-run after fast refresh)
      gl = (glCanvas.getContext("webgl", { antialias: true }) || glCanvas.getContext("experimental-webgl", { antialias: true })) as WebGLRenderingContext | null;
      if (gl) {
        const mk = (type: number, src: string) => {
          const sh = gl!.createShader(type)!;
          gl!.shaderSource(sh, src);
          gl!.compileShader(sh);
          if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(sh) ?? "shader compile failed");
          return sh;
        };
        glP = gl.createProgram()!;
        gl.attachShader(glP, mk(gl.VERTEX_SHADER, GL_VS));
        gl.attachShader(glP, mk(gl.FRAGMENT_SHADER, GL_FS));
        gl.linkProgram(glP);
        if (!gl.getProgramParameter(glP, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glP) ?? "program link failed");
        glLoc = {
          aPos: gl.getAttribLocation(glP, "aPos"), aT: gl.getAttribLocation(glP, "aT"), aShade: gl.getAttribLocation(glP, "aShade"),
          uYaw: gl.getUniformLocation(glP, "uYaw"), uPit: gl.getUniformLocation(glP, "uPit"), uScale: gl.getUniformLocation(glP, "uScale"),
          uF: gl.getUniformLocation(glP, "uF"), uRamp: gl.getUniformLocation(glP, "uRamp"), uAlpha: gl.getUniformLocation(glP, "uAlpha"),
          uFlat: gl.getUniformLocation(glP, "uFlat"), uFlatColor: gl.getUniformLocation(glP, "uFlatColor"), uMode: gl.getUniformLocation(glP, "uMode"),
        };
        glBuf = { pos: gl.createBuffer(), t: gl.createBuffer(), shade: gl.createBuffer(), idx: gl.createBuffer(), floor: gl.createBuffer() };
        glTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, glTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        uploadRampTex();
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
      }
    } catch (err) {
      console.warn("topo: WebGL unavailable, falling back to 2D painter", err);
      // A context that was created before setup failed (e.g. shader compile
      // rejected by a software rasterizer) leaves the canvas with an
      // uninitialized drawing buffer, which some compositors present as an
      // opaque white slab over the panel. Clearing it isn't reliable on a
      // half-dead context - hide the element instead; the 2D painter owns
      // the whole visual in fallback mode anyway.
      glCanvas.style.display = "none";
      gl = null;
    }

    const drawGL = (S: Surface, W: number, H: number, alpha: number) => {
      if (!gl || !glP) return;
      const dpr = devicePixelRatio || 1;
      if (glCanvas.width !== W * dpr || glCanvas.height !== H * dpr) {
        glCanvas.width = W * dpr;
        glCanvas.height = H * dpr;
      }
      if (glPalIdx !== stateRef.current.palIdx) uploadRampTex();
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      // Clear to the panel color opaquely (not transparent black): some
      // compositors show an alpha-0 WebGL canvas as white, which reads as a
      // glaring white slab in the dark UI.
      const paper = hex2rgb(pal.paper);
      gl.clearColor(paper[0] / 255, paper[1] / 255, paper[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(glP);
      if (glSurf !== S) { // upload this surface's mesh once (rebuilt only on data/mode change)
        glSurf = S;
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.pos); gl.bufferData(gl.ARRAY_BUFFER, S.glPos, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.t); gl.bufferData(gl.ARRAY_BUFFER, S.glT, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.shade); gl.bufferData(gl.ARRAY_BUFFER, S.glShade, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, S.glIdx, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.floor); gl.bufferData(gl.ARRAY_BUFFER, S.glFloor, gl.STATIC_DRAW);
      }
      const { yaw, pitch } = view.current;
      const scale = Math.min(W * 0.34, H * 0.58); // keep in sync with makeProject
      gl.uniform2f(glLoc.uYaw as WebGLUniformLocation, Math.cos(yaw), Math.sin(yaw));
      gl.uniform2f(glLoc.uPit as WebGLUniformLocation, Math.cos(pitch), Math.sin(pitch));
      gl.uniform2f(glLoc.uScale as WebGLUniformLocation, scale / (W / 2), scale / (H / 2));
      gl.uniform1f(glLoc.uF as WebGLUniformLocation, 3.8);
      gl.uniform1i(glLoc.uRamp as WebGLUniformLocation, 0);
      gl.uniform1f(glLoc.uMode as WebGLUniformLocation, PALETTES[stateRef.current.palIdx].mag ? 2 : 0);
      // floor grid (flat color pass, depth-tested so the terrain occludes it naturally)
      const ink = hex2rgb(pal.ink3);
      gl.disableVertexAttribArray(glLoc.aT as number);
      gl.vertexAttrib1f(glLoc.aT as number, 0.5);
      gl.disableVertexAttribArray(glLoc.aShade as number);
      gl.vertexAttrib1f(glLoc.aShade as number, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.floor);
      gl.enableVertexAttribArray(glLoc.aPos as number);
      gl.vertexAttribPointer(glLoc.aPos as number, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(glLoc.uFlat as WebGLUniformLocation, 1);
      gl.uniform3f(glLoc.uFlatColor as WebGLUniformLocation, ink[0] / 255, ink[1] / 255, ink[2] / 255);
      gl.uniform1f(glLoc.uAlpha as WebGLUniformLocation, alpha * 0.4);
      gl.drawArrays(gl.LINES, 0, S.glFloor.length / 3);
      // terrain
      gl.uniform1f(glLoc.uFlat as WebGLUniformLocation, 0);
      gl.uniform1f(glLoc.uAlpha as WebGLUniformLocation, alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.pos);
      gl.vertexAttribPointer(glLoc.aPos as number, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.t);
      gl.enableVertexAttribArray(glLoc.aT as number);
      gl.vertexAttribPointer(glLoc.aT as number, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuf.shade);
      gl.enableVertexAttribArray(glLoc.aShade as number);
      gl.vertexAttribPointer(glLoc.aShade as number, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuf.idx);
      gl.drawElements(gl.TRIANGLES, S.glIdx.length, gl.UNSIGNED_SHORT, 0);
    };

    /** Elevated 3/4 camera: yaw turntable, then tilt DOWN by pitch so the far edge sits higher. */
    const makeProject = (W: number, H: number) => {
      const { yaw, pitch } = view.current;
      const cy = H * 0.5;
      const cx = W / 2;
      const scale = Math.min(W * 0.34, H * 0.58);
      const f = 3.8;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      return (x: number, y: number, z: number) => {
        const xr = x * cosY - z * sinY;
        const zr = x * sinY + z * cosY;
        const yr = y * cosP + zr * sinP; // camera above: far (+z) projects UP
        const z2 = zr * cosP - y * sinP; // depth after tilt (larger = farther)
        const s = f / (f + z2);
        return { px: cx + xr * s * scale, py: cy - yr * s * scale, z: z2 };
      };
    };

    let pts: { px: number; py: number; r: number; c: number }[] = [];

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

      const st = stateRef.current;
      const modeId = st.modeIds[st.modeIdx];
      const S = modeId ? st.surfaces.get(modeId) : undefined;
      if (!S) return;
      const nC = S.cols.length;
      const { RR, CC } = S;
      const AMP = S.amp;
      const floorY = S.floorY;
      const alpha = 0.25 + 0.75 * view.current.fadeT;
      const proj = makeProject(W, H);
      const X = (c: number) => (c / (CC - 1)) * 2 - 1; // display col → model x
      const Z = (r: number) => ((r / (RR - 1)) * 2 - 1) * 0.6; // display row → model z
      const dispC = (c: number) => (c * (CC - 1)) / (nC - 1); // data col → display col
      const dispR = (r: number) => (r * (RR - 1)) / (ROWS - 1); // data row → display row

      ctx.globalAlpha = alpha;

      // Project the display mesh in JS regardless of renderer: hover picking,
      // spot column and peak labels all anchor to these screen positions.
      pts = [];
      const P: { px: number; py: number; z: number }[][] = [];
      for (let r = 0; r < RR; r++) {
        P.push([]);
        for (let c = 0; c < CC; c++) {
          const p = proj(X(c), S.hd[r][c] * AMP, Z(r));
          P[r].push(p);
          // Hover lookups stay in DATA space (raw values / tenor labels).
          pts.push({ px: p.px, py: p.py, r: Math.round((r * (ROWS - 1)) / (RR - 1)), c: Math.round((c * (nC - 1)) / (CC - 1)) });
        }
      }

      if (gl) {
        drawGL(S, W, H, alpha);
      } else {
        // 2D fallback: floor grid, then flat-shaded quads back-to-front.
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = pal.ink3;
        ctx.globalAlpha = alpha * 0.35;
        for (let c = 0; c < nC; c += 6) {
          const a = proj(X(dispC(c)), floorY, Z(0));
          const b = proj(X(dispC(c)), floorY, Z(RR - 1));
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
        }
        for (let r = 0; r < ROWS; r += 5) {
          const a = proj(X(0), floorY, Z(dispR(r)));
          const b = proj(X(CC - 1), floorY, Z(dispR(r)));
          ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
        }
        ctx.globalAlpha = alpha;

        const quads: { r: number; c: number; z: number; v: number; shade: number }[] = [];
        for (let r = 0; r < RR - 1; r++) {
          for (let c = 0; c < CC - 1; c++) {
            quads.push({
              r, c,
              z: (P[r][c].z + P[r + 1][c + 1].z) / 2,
              v: (S.hd[r][c] + S.hd[r][c + 1] + S.hd[r + 1][c] + S.hd[r + 1][c + 1]) / 4,
              // Vertex-averaged lambert, capped at 1.0 - multiplying past 1 clamps channels and washes the ramp out.
              shade: 0.62 + 0.38 * ((S.lam[r][c] + S.lam[r][c + 1] + S.lam[r + 1][c] + S.lam[r + 1][c + 1]) / 4),
            });
          }
        }
        quads.sort((a, b) => b.z - a.z);
        for (const q of quads) {
          const a = P[q.r][q.c], b = P[q.r][q.c + 1], d = P[q.r + 1][q.c + 1], e = P[q.r + 1][q.c];
          ctx.beginPath();
          ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.lineTo(d.px, d.py); ctx.lineTo(e.px, e.py); ctx.closePath();
          const fill = rgbStr(ramp(tOf(q.v)), q.shade);
          // Seam-seal with a same-color stroke (kills AA hairlines between quads).
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = fill;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Axis labels ON TOP of the surface (drawn after it, or the terrain silhouette eats the digits at some yaw angles).
      const kMin = S.cols[0];
      const kMax = S.cols[nC - 1];
      const span = kMax - kMin;
      const step = span > 240 ? 100 : span > 120 ? 50 : span > 24 ? 10 : span > 12 ? 5 : 2;
      ctx.fillStyle = pal.ink3;
      ctx.font = `9px ${monoFam}`;
      ctx.textAlign = "center";
      for (let k = Math.ceil(kMin / step) * step; k <= kMax; k += step) {
        const c = ((k - kMin) / span) * (CC - 1);
        const p = proj(X(c), floorY, Z(0));
        const p2 = proj(X(c), floorY - 0.03, Z(0));
        ctx.strokeStyle = pal.ink3;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p2.px, p2.py); ctx.stroke();
        label(String(k), p2.px, p2.py + 10, pal.ink3);
      }
      ctx.textAlign = "left";
      for (const rr of [0, 5, 10, 15]) {
        const p = proj(X(CC - 1) + 0.06, floorY, Z(dispR(rr)));
        label(st.tenorLabels[Math.round((rr / (ROWS - 1)) * 3)], p.px, p.py, pal.ink2);
      }

      // Spot column.
      let spotCol = -1;
      if (typeof st.spot === "number") {
        let best = Infinity;
        S.cols.forEach((k, i) => {
          const dd = Math.abs(k - st.spot);
          if (dd < best) { best = dd; spotCol = i; }
        });
        const sc = Math.round(dispC(spotCol));
        const top = P[RR - 1][sc];
        const bot = proj(X(sc), floorY, Z(0));
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(bot.px, bot.py); ctx.lineTo(top.px, top.py - 14); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 9px ${monoFam}`;
        ctx.textAlign = "center";
        label(`SPOT ${st.spot.toFixed(0)}`, top.px, top.py - 18, pal.accent);
      }

      // Auto-labelled peaks: the 2 strongest columns, named on the summit.
      const colPeak = S.cols.map((_, c) => {
        let v = 0;
        for (let r = 0; r < ROWS; r++) if (Math.abs(S.h[r][c]) > Math.abs(v)) v = S.h[r][c];
        return v;
      });
      // Keep labels clear of the SPOT tag (≥5 columns away) and of each other (≥8).
      const ranked = colPeak
        .map((v, c) => ({ v, c }))
        .filter((x) => Math.abs(x.v) > 0.45 && Math.abs(x.c - spotCol) > 5)
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
      const chosen: { v: number; c: number }[] = [];
      for (const cand of ranked) {
        if (chosen.length >= 2) break;
        if (chosen.every((x) => Math.abs(x.c - cand.c) >= 8)) chosen.push(cand);
      }
      ctx.font = `600 10px ${monoFam}`;
      ctx.textAlign = "center";
      for (const pk of chosen) {
        let bestR = 0;
        for (let r = 0; r < ROWS; r++) if (Math.abs(S.h[r][pk.c]) > Math.abs(S.h[bestR][pk.c])) bestR = r;
        const p = P[Math.round(dispR(bestR))][Math.round(dispC(pk.c))];
        // Ink + halo, not pole-colored: on the full-spectrum surface a colored tag gets lost.
        const tags = MODES.find((m) => m.id === modeId);
        label(`${S.cols[pk.c]} ${pk.v >= 0 ? tags?.posTag ?? "CALL" : tags?.negTag ?? "PUT"}`, p.px, p.py - 8, pal.ink);
      }

      // Legend: heat ramp + value scale, bottom-left (opaque backing so terrain labels can never collide with it).
      const lw = 96, lh = 6, lx = 12, ly = H - 20;
      ctx.fillStyle = pal.paper;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx - 8, ly - 18, lw + 60, 34);
      ctx.globalAlpha = alpha;
      const magPal = PALETTES[st.palIdx].mag;
      for (let i = 0; i < lw; i++) {
        ctx.fillStyle = rgbStr(ramp(i / (lw - 1)));
        ctx.fillRect(lx + i, ly, 1.2, lh);
      }
      ctx.strokeStyle = pal.ink3;
      ctx.lineWidth = 0.6;
      ctx.strokeRect(lx - 0.5, ly - 0.5, lw + 1, lh + 1);
      ctx.fillStyle = pal.ink3;
      ctx.font = `8.5px ${monoFam}`;
      const legendTags = MODES.find((m) => m.id === modeId);
      if (magPal) { // magnitude ramp: both poles glow - legend reads 0 → |max|
        ctx.textAlign = "left";
        ctx.fillText("0", lx, ly - 4);
        ctx.textAlign = "right";
        ctx.fillText(`±${fmtMag(S.maxAbs).slice(1)} WALL`, lx + lw, ly + lh + 11);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(`${legendTags?.negTag ?? "PUT"} −${fmtMag(S.maxAbs).slice(1)}`, lx, ly - 4);
        ctx.textAlign = "right";
        ctx.fillText(`+${fmtMag(S.maxAbs).slice(1)} ${legendTags?.posTag ?? "CALL"}`, lx + lw, ly + lh + 11);
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const st = stateRef.current;
      if (document.hidden || !canvas.offsetParent || !st.modeIds.length) return;
      const v = view.current;
      if (!reduced && now > v.dragUntil) v.yaw += 0.0028;
      if (!reduced && !st.controlled && now - v.lastCycle > CYCLE_MS && now > v.pinnedUntil && st.modeIds.length > 1) {
        v.lastCycle = now;
        v.fadeT = 0;
        setModeIdx((i) => (i + 1) % st.modeIds.length);
      }
      v.fadeT = Math.min(1, v.fadeT + 0.06);
      draw();
    };
    raf = requestAnimationFrame(frame);

    // ── interaction ──
    let dragging = false, lx = 0, ly = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onUp = () => {
      dragging = false;
      view.current.dragUntil = performance.now() + 6000;
    };
    const onMove = (e: PointerEvent) => {
      const v = view.current;
      if (dragging) {
        v.yaw += (e.clientX - lx) * 0.006;
        v.pitch = Math.max(0.15, Math.min(1.15, v.pitch + (e.clientY - ly) * 0.004));
        lx = e.clientX;
        ly = e.clientY;
        v.dragUntil = performance.now() + 6000;
        return;
      }
      const st = stateRef.current;
      const modeId = st.modeIds[st.modeIdx];
      const S = modeId ? st.surfaces.get(modeId) : undefined;
      if (!S) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let bp: { px: number; py: number; r: number; c: number } | null = null;
      let bd = 22 * 22;
      for (const p of pts) {
        const dd = (p.px - mx) ** 2 + (p.py - my) ** 2;
        if (dd < bd) { bd = dd; bp = p; }
      }
      if (bp) {
        const val = S.raw[bp.r][bp.c];
        setReadout(`$${S.cols[bp.c]} · ${fmtMag(val)} ${st.tenorLabels[Math.round((bp.r / (ROWS - 1)) * 3)]}`);
      } else {
        setReadout("");
      }
    };
    const onLeave = () => setReadout("");
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  if (!modeIds.length) {
    return <p className="m-0 py-16 text-center font-mono text-[0.75rem] text-[var(--text-faint)]">No cross-expiry surface data this request — topography needs the source surfaces.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--border)]">
          {!controlled &&
            modeIds.map((id, i) => {
              const m = MODES.find((x) => x.id === id)!;
              return (
                <button
                  key={id}
                  onClick={() => {
                    setModeIdx(i);
                    view.current.fadeT = 0;
                    view.current.pinnedUntil = performance.now() + PIN_MS;
                  }}
                  className={`px-3 py-1 font-mono text-[0.62rem] font-semibold tracking-[0.05em] transition-colors duration-150 ${
                    i === activeIdx ? "bg-[var(--text)] text-[var(--bg)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          <button
            onClick={() => {
              const next = (palIdx + 1) % PALETTES.length;
              setPalIdx(next);
              try { localStorage.setItem(PAL_STORAGE_KEY, PALETTES[next].id); } catch { /* private mode */ }
              view.current.fadeT = 0;
              view.current.pinnedUntil = performance.now() + PIN_MS;
            }}
            title="cycle color scheme"
            className="border-l border-[var(--border)] px-3 py-1 font-mono text-[0.62rem] font-semibold tracking-[0.05em] text-[var(--accent)] transition-colors duration-150 hover:text-[var(--text)]"
            suppressHydrationWarning
          >
            {PALETTES[palIdx].label}
          </button>
        </div>
        <div className="min-h-[1rem] font-mono text-[0.68rem] font-semibold text-[var(--text)]">{readout}</div>
      </div>
      <div className="relative w-full touch-none select-none" style={{ height }}>
        <canvas ref={glCanvasRef} className="absolute inset-0 h-full w-full" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing" />
      </div>
      <p className="m-0 font-mono text-[0.6rem] leading-relaxed text-[var(--text-faint)]">{activeMode.caption} · drag to rotate · values from the source cross-expiry surfaces (raw-magnitude proxy)</p>
    </div>
  );
}
