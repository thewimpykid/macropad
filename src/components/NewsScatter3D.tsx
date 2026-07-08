"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { NewsHeadlinePayload } from "@/lib/macroData";

const WIDTH = 6.5; // x span: time, oldest -> newest
const HEIGHT = 3.2; // y span: sentiment, -1..1
const DEPTH = 2.4; // z span: jitter, purely visual separation

function toneColor(label: NewsHeadlinePayload["sentimentLabel"]): string {
  return label === "bullish" ? "#22ff88" : label === "bearish" ? "#ff3b3b" : "#5a5a5a";
}

/** Deterministic per-index jitter so points don't overlap, no randomness on every render. */
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function Dot({
  position,
  color,
  size,
  active,
  onHover,
}: {
  position: [number, number, number];
  color: string;
  size: number;
  active: boolean;
  onHover: (hovered: boolean) => void;
}) {
  return (
    <mesh
      position={position}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
    >
      <sphereGeometry args={[active ? size * 1.7 : size, 10, 10]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 1.6 : 0.75} />
    </mesh>
  );
}

/** Faint reference floor grid - a "surface" to ground the point cloud, no data encoded in it. */
function Floor() {
  const geo = useMemo(() => new THREE.PlaneGeometry(WIDTH + 1, DEPTH + 1, 14, 6), []);
  return (
    <lineSegments position={[0, -HEIGHT / 2 - 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <edgesGeometry args={[geo]} />
      <lineBasicMaterial color="#1c1c1c" transparent opacity={0.6} />
    </lineSegments>
  );
}

export default function NewsScatter3D({ headlines }: { headlines: NewsHeadlinePayload[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin: "300px 0px",
      threshold: 0.01,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Newest first in the feed -> oldest at x=0, newest at x=WIDTH.
  const ordered = useMemo(() => [...headlines].reverse(), [headlines]);

  const points = useMemo(
    () =>
      ordered.map((h, i) => {
        const t = ordered.length > 1 ? i / (ordered.length - 1) : 0.5;
        const x = t * WIDTH - WIDTH / 2;
        const y = h.sentimentScore * (HEIGHT / 2);
        const z = jitter(i) * (DEPTH / 2);
        const size = 0.035 + Math.abs(h.sentimentScore) * 0.05;
        return { pos: [x, y, z] as [number, number, number], size, headline: h };
      }),
    [ordered]
  );

  const activeIdx = hoverIdx ?? pinnedIdx;
  const active = activeIdx !== null ? ordered[activeIdx] : null;

  const bullishCount = headlines.filter((h) => h.sentimentLabel === "bullish").length;
  const bearishCount = headlines.filter((h) => h.sentimentLabel === "bearish").length;
  const neutralCount = headlines.length - bullishCount - bearishCount;

  return (
    <div ref={containerRef}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="eyebrow">{headlines.length} headlines, oldest → newest (drag to rotate)</div>
        <div className="flex gap-3 font-mono text-[0.68rem] text-[var(--text-faint)]">
          <span style={{ color: "var(--up)" }}>● {bullishCount} bullish</span>
          <span style={{ color: "var(--text-faint)" }}>● {neutralCount} neutral</span>
          <span style={{ color: "var(--down)" }}>● {bearishCount} bearish</span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.62rem] text-[var(--text-faint)]">
        <span>X axis: time, oldest to newest, left to right</span>
        <span>Y axis: sentiment score, -1 bearish to +1 bullish, bottom to top</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div
          className="h-[360px] w-full overflow-hidden border border-[var(--border)] bg-black"
          onClick={() => setPinnedIdx(hoverIdx)}
        >
          {inView ? (
            <Canvas camera={{ position: [0, 1.6, 7], fov: 42 }} dpr={[1, 1.6]}>
              <ambientLight intensity={0.6} />
              <directionalLight position={[4, 5, 4]} intensity={1} />
              <directionalLight position={[-4, -2, -3]} intensity={0.3} />
              <Floor />
              {points.map((p, i) => (
                <Dot
                  key={i}
                  position={p.pos}
                  color={toneColor(p.headline.sentimentLabel)}
                  size={p.size}
                  active={activeIdx === i}
                  onHover={(hovered) => setHoverIdx(hovered ? i : null)}
                />
              ))}
              <OrbitControls enablePan={false} minDistance={3} maxDistance={12} autoRotate autoRotateSpeed={0.4} />
            </Canvas>
          ) : (
            <div className="flex h-full items-center justify-center font-sans text-[0.7rem] text-[var(--text-faint)]">
              Scroll into view to render…
            </div>
          )}
        </div>

        <div className="flex flex-col border border-[var(--border)] bg-[var(--panel-2)] p-3.5">
          {active ? (
            <>
              <span className="mb-1.5 w-fit text-[0.66rem] font-bold uppercase tracking-wide" style={{ color: toneColor(active.sentimentLabel) }}>
                {active.sentimentLabel} · {active.sentimentScore > 0 ? "+" : ""}
                {active.sentimentScore.toFixed(2)}
              </span>
              <p className="m-0 font-sans text-[0.82rem] leading-snug text-[var(--text)]">{active.title}</p>
              <div className="mt-2 font-mono text-[0.66rem] text-[var(--text-faint)]">
                {active.source} · {new Date(active.pubDate).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
              {active.link && (
                <a href={active.link} target="_blank" rel="noopener noreferrer" className="mt-2 font-sans text-[0.72rem] font-semibold text-[var(--accent)] hover:underline">
                  Open source ↗
                </a>
              )}
            </>
          ) : (
            <p className="m-0 font-sans text-[0.78rem] leading-snug text-[var(--text-faint)]">
              Hover any dot to read that headline. X = time, Y = sentiment score.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
