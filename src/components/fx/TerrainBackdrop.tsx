import AsciiContour from "@/components/fx/AsciiContour";

/*
 * Site-wide terrain: one fixed viewport-sized ASCII contour canvas behind
 * every page. It sits first in the body so anything with a real background
 * paints over it; content scrolls across the drifting map like markers on
 * a chart table. One canvas for the whole site - cheaper than the old
 * per-section instances.
 */
export default function TerrainBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0">
      <AsciiContour className="h-full w-full" maxAlpha={0.5} />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 90% 90% at 50% 40%, transparent 45%, var(--bg) 100%)" }}
      />
    </div>
  );
}
