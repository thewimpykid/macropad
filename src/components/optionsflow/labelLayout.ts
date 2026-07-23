/**
 * 1-D label lane layout shared by the spine and bar strike views: a set of
 * movable labels (wall/pain/flip callouts) laid out around one immovable
 * pivot (the live spot tag). Labels keep their price order, never overlap
 * each other, and never enter the pivot's exclusion band - labels whose true
 * price is above spot resolve upward, below-spot labels resolve downward, so
 * a callout can't visually cross to the wrong side of the spot cursor.
 */

import { fmtNum } from "@/lib/gex";

export interface LaneItem {
  key: string;
  /** Ideal y (the true price position). */
  y: number;
}

export function layoutAroundPivot(
  items: LaneItem[],
  pivotY: number,
  opts: { pivotGap: number; minGap: number; top: number; bottom: number }
): Map<string, number> {
  const { pivotGap, minGap, top, bottom } = opts;
  const out = new Map<string, number>();

  function place(group: LaneItem[], lo: number, hi: number) {
    if (!group.length) return;
    const ys: number[] = [];
    for (let i = 0; i < group.length; i++) {
      ys.push(i === 0 ? Math.max(lo, group[i].y) : Math.max(group[i].y, ys[i - 1] + minGap));
    }
    const overflow = ys[ys.length - 1] - hi;
    if (overflow > 0) for (let i = 0; i < ys.length; i++) ys[i] -= overflow;
    // Re-assert the floor + spacing in case the overflow shift compressed the top.
    for (let i = 0; i < ys.length; i++) {
      ys[i] = i === 0 ? Math.max(lo, ys[i]) : Math.max(ys[i], ys[i - 1] + minGap);
    }
    group.forEach((it, i) => out.set(it.key, ys[i]));
  }

  const sorted = [...items].sort((a, b) => a.y - b.y);
  place(
    sorted.filter((i) => i.y <= pivotY),
    top,
    pivotY - pivotGap
  );
  place(
    sorted.filter((i) => i.y > pivotY),
    pivotY + pivotGap,
    bottom
  );
  return out;
}

/** Strike prices are whole numbers on the index products - drop the ".00" noise, keep decimals only when the strike actually has them. */
export function fmtStrikeLabel(price: number): string {
  return fmtNum(price, Number.isInteger(price) ? 0 : 2);
}
