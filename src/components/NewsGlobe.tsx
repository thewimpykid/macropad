"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { NewsHeadlinePayload } from "@/lib/macroData";
import { locateHeadline, type GeoPoint } from "@/lib/geoNews";

/*
 * Navigable news globe: real NASA Earth imagery - a dimly lit day map with
 * the Black Marble city-lights layer glowing through the night side - with
 * each headline pinned to its inferred location (central-bank capitals,
 * market centers, conflict regions) and colored by sentiment. Drag to
 * rotate, scroll to zoom, hover a particle to read the story.
 */

const R = 2.6;

function toneColor(label: NewsHeadlinePayload["sentimentLabel"]): string {
  return label === "bullish" ? "#3ecf8e" : label === "bearish" ? "#f0555d" : "#9c9ca3";
}

/**
 * Matches three.js SphereGeometry UVs, so lat/lon lands on the right spot
 * of an equirectangular Earth texture.
 */
function latLonToVec3(lat: number, lon: number, radius: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}

/** Soft round glow texture for story particles. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function Earth() {
  const [day, lights] = useLoader(THREE.TextureLoader, ["/textures/earth_day.jpg", "/textures/earth_lights.png"]);
  day.colorSpace = THREE.SRGBColorSpace;
  lights.colorSpace = THREE.SRGBColorSpace;
  day.anisotropy = 4;
  lights.anisotropy = 4;
  return (
    <mesh>
      <sphereGeometry args={[R, 64, 64]} />
      <meshStandardMaterial
        map={day}
        emissiveMap={lights}
        emissive="#ffd9a0"
        emissiveIntensity={1.15}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

/** Thin additive rim so the sphere reads as an atmosphere-lit body. */
function Atmosphere() {
  const texture = useMemo(() => {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, "rgba(120,166,240,0)");
    g.addColorStop(0.64, "rgba(120,166,240,0)");
    g.addColorStop(0.72, "rgba(140,180,255,0.22)");
    g.addColorStop(0.8, "rgba(140,180,255,0.06)");
    g.addColorStop(1.0, "rgba(140,180,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }, []);

  return (
    <sprite scale={[R * 2.9, R * 2.9, 1]} renderOrder={-1}>
      <spriteMaterial map={texture} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
  );
}

function NewsDot({
  position,
  color,
  active,
  glows,
  glowTexture,
  onHover,
}: {
  position: [number, number, number];
  color: string;
  active: boolean;
  /** Only directional (bullish/bearish) stories glow - dozens of stacked neutral glows would white out a cluster. */
  glows: boolean;
  glowTexture: THREE.Texture;
  onHover: (hovered: boolean) => void;
}) {
  const glow = active ? 0.42 : 0.26;
  return (
    <group position={position}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
        }}
        onPointerOut={() => onHover(false)}
      >
        <sphereGeometry args={[active ? 0.07 : 0.045, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {(glows || active) && (
        <sprite scale={[glow, glow, 1]} renderOrder={2}>
          <spriteMaterial
            map={glowTexture}
            color={color}
            transparent
            opacity={active ? 0.9 : 0.35}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      )}
    </group>
  );
}

export default function NewsGlobe({ headlines }: { headlines: NewsHeadlinePayload[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const glowTexture = useMemo(() => (typeof document !== "undefined" ? makeGlowTexture() : null), []);

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

  const points = useMemo(
    () =>
      headlines.map((h, i) => {
        const geo: GeoPoint = locateHeadline(h, i);
        return { pos: latLonToVec3(geo.lat, geo.lon, R + 0.06), geo, headline: h };
      }),
    [headlines]
  );

  const activeIdx = hoverIdx ?? pinnedIdx;
  const active = activeIdx !== null ? points[activeIdx] : null;

  const bullishCount = headlines.filter((h) => h.sentimentLabel === "bullish").length;
  const bearishCount = headlines.filter((h) => h.sentimentLabel === "bearish").length;
  const neutralCount = headlines.length - bullishCount - bearishCount;

  return (
    <div ref={containerRef}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="eyebrow">{headlines.length} headlines, pinned where the story points. Drag to navigate</div>
        <div className="flex gap-3 font-mono text-[0.68rem] text-[var(--text-faint)]">
          <span style={{ color: "var(--up)" }}>● {bullishCount} bullish</span>
          <span style={{ color: "var(--text-faint)" }}>● {neutralCount} neutral</span>
          <span style={{ color: "var(--down)" }}>● {bearishCount} bearish</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div
          className="hud h-[360px] w-full overflow-hidden border border-[var(--border)] bg-black"
          onClick={() => setPinnedIdx(hoverIdx)}
        >
          {inView ? (
            <Canvas camera={{ position: [2.85, 3.1, 3.4], fov: 42 }} dpr={[1, 1.6]}>
              <ambientLight intensity={0.32} />
              <directionalLight position={[4, 2.5, 4]} intensity={0.85} color="#dfe8ff" />
              <Suspense fallback={null}>
                <Earth />
              </Suspense>
              <Atmosphere />
              {glowTexture &&
                points.map((p, i) => (
                  <NewsDot
                    key={i}
                    position={p.pos}
                    color={toneColor(p.headline.sentimentLabel)}
                    active={activeIdx === i}
                    glows={p.headline.sentimentLabel !== "neutral"}
                    glowTexture={glowTexture}
                    onHover={(hovered) => setHoverIdx(hovered ? i : null)}
                  />
                ))}
              <OrbitControls
                enablePan={false}
                minDistance={3.4}
                maxDistance={10}
                autoRotate
                autoRotateSpeed={0.45}
                rotateSpeed={0.55}
              />
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
              <span
                className="mb-1.5 w-fit font-mono text-[0.64rem] font-bold uppercase tracking-[0.08em]"
                style={{ color: toneColor(active.headline.sentimentLabel) }}
              >
                [{active.headline.sentimentLabel} {active.headline.sentimentScore > 0 ? "+" : ""}
                {active.headline.sentimentScore.toFixed(2)}]
              </span>
              <p className="m-0 font-sans text-[0.82rem] leading-snug text-[var(--text)]">{active.headline.title}</p>
              <div className="mt-2 font-mono text-[0.66rem] text-[var(--text-faint)]">
                {active.geo.place} ·{" "}
                {new Date(active.headline.pubDate).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              {active.headline.link && (
                <a
                  href={active.headline.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 font-sans text-[0.72rem] font-semibold text-[var(--accent)] hover:underline"
                >
                  Open source ↗
                </a>
              )}
            </>
          ) : (
            <p className="m-0 font-sans text-[0.78rem] leading-snug text-[var(--text-faint)]">
              Hover a particle to read that story. Position is the story&apos;s inferred market center; color is
              sentiment.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
