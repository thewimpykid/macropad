const NAV_ORDER_KEY = "trifekta:navOrder";
// Pre-rebrand key - read as fallback so existing users keep their tab order.
const LEGACY_NAV_ORDER_KEY = "macropad:navOrder";

export interface NavOrderState {
  a: string[]; // News + indicator panels
  b: string[]; // Macro Bias / Replay / Fingerprint / Calendar
}

/** Reconciles a stored order with the current default: keeps stored positions for ids that still exist, appends any new ids (future panels) at the end, drops stale ones. */
function reconcile(stored: string[] | undefined, current: string[]): string[] {
  if (!stored) return current;
  const known = new Set(current);
  const kept = stored.filter((id) => known.has(id));
  const missing = current.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

export function loadNavOrder(defaultA: string[], defaultB: string[]): NavOrderState {
  if (typeof window === "undefined") return { a: defaultA, b: defaultB };
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY) ?? localStorage.getItem(LEGACY_NAV_ORDER_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<NavOrderState>) : undefined;
    return { a: reconcile(parsed?.a, defaultA), b: reconcile(parsed?.b, defaultB) };
  } catch {
    return { a: defaultA, b: defaultB };
  }
}

export function saveNavOrder(order: NavOrderState) {
  try {
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch {
    // localStorage unavailable - order just won't persist
  }
}

/** Move `id` to the position `overId` currently occupies (drag-and-drop live reorder). */
export function moveToPosition(order: string[], id: string, overId: string): string[] {
  const from = order.indexOf(id);
  const to = order.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return order;
  const copy = order.slice();
  copy.splice(from, 1);
  copy.splice(to, 0, id);
  return copy;
}
