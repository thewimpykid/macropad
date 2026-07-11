"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACCENT_PRESETS, applyThemePrefs, loadThemePrefs, saveThemePrefs, type AccentPreset, type ThemeMode, type MotionPref } from "@/lib/theme";
import { SegmentedControl } from "@/components/BiasView";

function GearIcon({ className }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5V4.3M10 15.7V17.5M17.5 10H15.7M4.3 10H2.5M15.1 4.9L13.8 6.2M6.2 13.8L4.9 15.1M15.1 15.1L13.8 13.8M6.2 6.2L4.9 4.9" />
    </svg>
  );
}

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  // Fixed-position coordinates so the popover escapes the sidebar's
  // overflow-y-auto (absolute positioning gets clipped/scrolled inside it).
  // Computed by measuring the popover's actual rendered height (see the
  // layout effect below) rather than guessing - a guessed cap based only on
  // space-above-the-button still clipped content whenever the guess came in
  // a little short, with no visible scrollbar to reveal the rest.
  type Pos = { left: number; top?: number; bottom?: number; maxHeight: number };
  const [pos, setPos] = useState<Pos | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [accent, setAccent] = useState<AccentPreset>("mono");
  const [motion, setMotion] = useState<MotionPref>("on");
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefs = loadThemePrefs();
    setTheme(prefs.theme);
    setAccent(prefs.accent);
    setMotion(prefs.motion);
    // Re-assert on mount: hydration recovery can wipe the <html> attributes
    // the pre-paint init script set, which left the UI saying "light" while
    // the page rendered dark.
    applyThemePrefs(prefs.theme, prefs.accent, prefs.motion);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggleOpen() {
    setOpen((v) => !v);
  }

  // Runs after the popover is in the DOM (invisible, at a neutral spot) but
  // before paint, so its real height is known before we decide where it
  // goes - flips to open downward when there isn't room above, and only
  // falls back to an internal scroll if neither direction has enough space.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    if (!btnRef.current || !popRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 240;
    const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - width - 8));
    const margin = 8;
    const height = popRef.current.getBoundingClientRect().height;
    const spaceAbove = r.top - margin * 2;
    const spaceBelow = window.innerHeight - r.bottom - margin * 2;

    if (height <= spaceAbove || spaceAbove >= spaceBelow) {
      setPos({ left, bottom: window.innerHeight - r.top + margin, maxHeight: Math.max(120, spaceAbove) });
    } else {
      setPos({ left, top: r.bottom + margin, maxHeight: Math.max(120, spaceBelow) });
    }
  }, [open]);

  function updateTheme(next: ThemeMode) {
    setTheme(next);
    applyThemePrefs(next, accent, motion);
    saveThemePrefs(next, accent, motion);
  }

  function updateAccent(next: AccentPreset) {
    setAccent(next);
    applyThemePrefs(theme, next, motion);
    saveThemePrefs(theme, next, motion);
  }

  function updateMotion(next: MotionPref) {
    setMotion(next);
    applyThemePrefs(theme, accent, next);
    saveThemePrefs(theme, accent, next);
  }

  return (
    <div ref={ref}>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        aria-label="Display settings"
        className={`flex h-6 w-6 items-center justify-center transition-colors ${open ? "text-[var(--text)]" : "text-[var(--text-faint)] hover:text-[var(--text-dim)]"}`}
      >
        <GearIcon />
      </button>

      {open && (
        <div
          ref={popRef}
          className="z-50 w-60 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--panel-2)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
          style={{
            position: "fixed",
            left: pos?.left ?? -9999,
            top: pos?.top,
            bottom: pos?.top === undefined ? pos?.bottom ?? 0 : undefined,
            maxHeight: pos?.maxHeight,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          <div className="mb-3">
            <div className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-[var(--text-faint)]">Theme</div>
            <SegmentedControl
              options={[
                { id: "dark" as const, label: "Dark" },
                { id: "light" as const, label: "Light" },
              ]}
              value={theme}
              onChange={updateTheme}
              grow
            />
          </div>

          <div className="mb-3">
            <div className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-[var(--text-faint)]">Background</div>
            <SegmentedControl
              options={[
                { id: "on" as const, label: "Moving" },
                { id: "off" as const, label: "Still" },
              ]}
              value={motion}
              onChange={updateMotion}
              grow
            />
          </div>

          <div className="mb-3">
            <div className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-[var(--text-faint)]">Accent</div>
            <div className="flex flex-wrap gap-1.5">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => updateAccent(p.id)}
                  aria-label={p.label}
                  title={p.label}
                  className="flex h-6 w-6 items-center justify-center rounded-full border transition-transform"
                  style={{
                    borderColor: accent === p.id ? "var(--text)" : "var(--border)",
                    transform: accent === p.id ? "scale(1.08)" : undefined,
                  }}
                >
                  <span className="h-3.5 w-3.5 rounded-full border border-[var(--border)]" style={{ background: p.swatch }} />
                </button>
              ))}
            </div>
          </div>

          <p className="m-0 font-sans text-[0.62rem] leading-snug text-[var(--text-faint)]">
            Tip: drag a tab by the grip on its right edge to reorder. Board and Docs stay pinned.
          </p>
        </div>
      )}
    </div>
  );
}
