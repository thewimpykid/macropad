"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum } from "d3-force";
import type { MacroPanel } from "@/lib/macroData";
import type { MarketRow } from "@/lib/getMarkets";
import { IMPACTS, marketRowId } from "@/lib/markets";
import { alignByDate, pearson } from "@/lib/stats";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  kind: "indicator" | "market" | "panel";
  panelId?: string;
  tone: "up" | "down" | "flat";
  radius: number;
}

interface GraphLink {
  source: string;
  target: string;
  r: number | null;
  kind: "panel-membership" | "market-link";
}

const PANEL_COLORS: Record<string, string> = {
  "us-macro": "#e8a33d",
  "yield-rates": "#4C9EFF",
  "cot-positioning": "#c084fc",
  transmission: "#f472b6",
  geopolitics: "#38bdf8",
};

function edgeColor(r: number | null, kind: GraphLink["kind"]): string {
  if (kind === "panel-membership") return "color-mix(in srgb, var(--text-faint) 30%, transparent)";
  if (r === null) return "var(--border)";
  const abs = Math.min(1, Math.abs(r));
  return r >= 0
    ? `color-mix(in srgb, var(--up) ${Math.round(abs * 80)}%, var(--border))`
    : `color-mix(in srgb, var(--down) ${Math.round(abs * 80)}%, var(--border))`;
}

export default function TopologyGraph({ panels, markets }: { panels: MacroPanel[]; markets: MarketRow[] }) {
  const width = 1100;
  const height = 720;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const draggingId = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const MIN_K = 0.25;
  const MAX_K = 3;

  const { nodes, links } = useMemo(() => {
    const marketById = new Map(markets.map((m) => [m.id, m]));
    const nodeList: GraphNode[] = [];
    const linkList: GraphLink[] = [];
    const usedMarketIds = new Set<string>();

    for (const panel of panels) {
      nodeList.push({ id: `panel:${panel.id}`, label: panel.title, kind: "panel", tone: "flat", radius: 10 });

      for (const s of panel.series) {
        if (!s.history || s.history.length < 20) continue;
        nodeList.push({
          id: s.id,
          label: s.name,
          kind: "indicator",
          panelId: panel.id,
          tone: s.status === "up" ? "up" : s.status === "down" ? "down" : "flat",
          radius: 13,
        });
        linkList.push({ source: `panel:${panel.id}`, target: s.id, r: null, kind: "panel-membership" });

        const impacts = IMPACTS[s.id];
        if (impacts) {
          for (const impact of impacts) {
            const marketId = marketRowId(impact.symbol);
            const market = marketById.get(marketId);
            if (market && market.history) {
              usedMarketIds.add(marketId);
              const aligned = alignByDate(s.history, market.history, 6);
              const r = pearson(aligned.a, aligned.b);
              linkList.push({ source: s.id, target: marketId, r, kind: "market-link" });
            }
          }
        }
      }
    }

    for (const id of usedMarketIds) {
      const market = marketById.get(id)!;
      nodeList.push({
        id,
        label: market.name,
        kind: "market",
        tone: market.status === "up" ? "up" : market.status === "down" ? "down" : "flat",
        radius: 16,
      });
    }

    return { nodes: nodeList, links: linkList };
  }, [panels, markets]);

  useEffect(() => {
    nodesRef.current = nodes.map((n) => ({ ...n }));
    const sim = forceSimulation<GraphNode>(nodesRef.current)
      .force(
        "link",
        forceLink<GraphNode, GraphLink & { source: string | GraphNode; target: string | GraphNode }>(links as never)
          .id((d) => (d as GraphNode).id)
          .distance((d) => ((d as unknown as GraphLink).kind === "panel-membership" ? 70 : 130))
          .strength((d) => ((d as unknown as GraphLink).kind === "panel-membership" ? 0.5 : 0.15))
      )
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(width / 2, height / 2))
      .force(
        "collide",
        forceCollide<GraphNode>().radius((d) => d.radius + 14)
      )
      .alphaDecay(0.02);

    simRef.current = sim;

    sim.on("tick", () => {
      const next = new Map<string, { x: number; y: number }>();
      for (const n of nodesRef.current) {
        next.set(n.id, { x: n.x ?? width / 2, y: n.y ?? height / 2 });
      }
      setPositions(next);
    });

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  /** Raw SVG viewBox coordinates (before the pan/zoom transform). */
  function toViewboxPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }

  /** Graph-space coordinates, inverting the current pan/zoom. */
  function toGraphPoint(clientX: number, clientY: number) {
    const vb = toViewboxPoint(clientX, clientY);
    return { x: (vb.x - view.x) / view.k, y: (vb.y - view.y) / view.k };
  }

  function handleNodePointerDown(id: string, e: React.PointerEvent) {
    e.stopPropagation();
    draggingId.current = id;
    simRef.current?.alphaTarget(0.3).restart();
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingId.current) {
      const p = toGraphPoint(e.clientX, e.clientY);
      const node = nodesRef.current.find((n) => n.id === draggingId.current);
      if (node) {
        node.fx = p.x;
        node.fy = p.y;
      }
      return;
    }
    if (panRef.current.active) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setView((v) => ({ ...v, x: panRef.current.origX + dx, y: panRef.current.origY + dy }));
    }
  }

  function handlePointerUp() {
    if (draggingId.current) {
      const node = nodesRef.current.find((n) => n.id === draggingId.current);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      draggingId.current = null;
      simRef.current?.alphaTarget(0);
    }
    panRef.current.active = false;
  }

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const vb = toViewboxPoint(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const nextK = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      // keep the point under the cursor fixed while zooming
      const nx = vb.x - ((vb.x - v.x) / v.k) * nextK;
      const ny = vb.y - ((vb.y - v.y) / v.k) * nextK;
      return { x: nx, y: ny, k: nextK };
    });
  }

  function zoomBy(factor: number) {
    setView((v) => {
      const nextK = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const cx = width / 2;
      const cy = height / 2;
      const nx = cx - ((cx - v.x) / v.k) * nextK;
      const ny = cy - ((cy - v.y) / v.k) * nextK;
      return { x: nx, y: ny, k: nextK };
    });
  }

  function resetView() {
    setView({ x: 0, y: 0, k: 1 });
  }

  const connected = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    for (const l of links) {
      const s = typeof l.source === "string" ? l.source : (l.source as unknown as GraphNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as unknown as GraphNode).id;
      if (s === hoverId) set.add(t);
      if (t === hoverId) set.add(s);
    }
    return set;
  }, [hoverId, links]);

  return (
    <div className="relative rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--panel-2)_60%,black)] p-2">
      <div className="absolute right-4 top-4 z-10 flex flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)]">
        <button
          onClick={() => zoomBy(1.3)}
          className="flex h-8 w-8 items-center justify-center border-b border-[var(--border)] font-mono text-[1rem] text-[var(--text-dim)] hover:text-[var(--text)]"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomBy(1 / 1.3)}
          className="flex h-8 w-8 items-center justify-center border-b border-[var(--border)] font-mono text-[1rem] text-[var(--text-dim)] hover:text-[var(--text)]"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="flex h-8 w-8 items-center justify-center font-mono text-[0.65rem] text-[var(--text-dim)] hover:text-[var(--text)]"
          aria-label="Reset view"
        >
          1:1
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        style={{ minHeight: 560, cursor: panRef.current.active ? "grabbing" : "grab" }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {links.map((l, i) => {
          const s = typeof l.source === "string" ? l.source : (l.source as unknown as GraphNode).id;
          const t = typeof l.target === "string" ? l.target : (l.target as unknown as GraphNode).id;
          const p1 = positions.get(s);
          const p2 = positions.get(t);
          if (!p1 || !p2) return null;
          const dimmed = connected && !(connected.has(s) && connected.has(t));
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={edgeColor(l.r, l.kind)}
              strokeWidth={l.kind === "market-link" ? 1 + Math.abs(l.r ?? 0) * 3.5 : 1}
              opacity={dimmed ? 0.08 : l.kind === "panel-membership" ? 0.35 : 0.8}
              style={{ transition: "opacity 150ms" }}
            />
          );
        })}

        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const dimmed = connected && !connected.has(n.id);
          const color =
            n.kind === "panel"
              ? PANEL_COLORS[n.id.replace("panel:", "")] ?? "var(--text-faint)"
              : n.tone === "up"
                ? "var(--up)"
                : n.tone === "down"
                  ? "var(--down)"
                  : n.kind === "market"
                    ? "var(--accent)"
                    : "var(--text-faint)";
          return (
            <g
              key={n.id}
              opacity={dimmed ? 0.25 : 1}
              style={{ transition: "opacity 150ms", cursor: "grab" }}
              onPointerDown={(e) => handleNodePointerDown(n.id, e)}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={n.radius}
                fill={n.kind === "panel" ? "transparent" : "color-mix(in srgb, var(--panel) 85%, black)"}
                stroke={color}
                strokeWidth={n.kind === "panel" ? 2 : hoverId === n.id ? 2.5 : 1.4}
                style={n.kind !== "panel" ? { filter: `drop-shadow(0 0 5px color-mix(in srgb, ${color} 55%, transparent))` } : undefined}
              />
              {(hoverId === n.id || n.kind === "panel" || n.kind === "market") && (
                <text
                  x={p.x}
                  y={p.y + n.radius + 12}
                  textAnchor="middle"
                  fontSize={n.kind === "panel" ? 11 : 9.5}
                  fontWeight={n.kind === "panel" ? 700 : 500}
                  fontFamily="var(--font-sans)"
                  fill={n.kind === "panel" ? color : "var(--text)"}
                  style={{ pointerEvents: "none" }}
                >
                  {n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label}
                </text>
              )}
            </g>
          );
        })}
        </g>
      </svg>

      <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] px-4 py-3 font-sans text-[0.68rem] text-[var(--text-faint)]">
        <span>Drag a node to move it, drag empty space to pan, scroll to zoom.</span>
        {Object.entries(PANEL_COLORS).map(([id, color]) => {
          const panel = panels.find((p) => p.id === id);
          if (!panel) return null;
          return (
            <span key={id} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {panel.title}
            </span>
          );
        })}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border" style={{ borderColor: "var(--accent)" }} />
          Market
        </span>
      </div>
    </div>
  );
}
