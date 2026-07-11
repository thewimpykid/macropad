export type ThemeMode = "dark" | "light";
export type AccentPreset = "mono" | "green" | "blue" | "amber" | "purple" | "red";
export type MotionPref = "on" | "off";
export type SignalPreset = "classic" | "ocean" | "violet" | "inverted";
export type UiFont = "geist" | "inter" | "grotesk";
export type DataFont = "jet" | "plex" | "fira";
export type DensityPref = "comfortable" | "compact";
export type SidebarSide = "left" | "right";
export type ControlsPos = "bottom" | "top";

export interface ThemePrefs {
  theme: ThemeMode;
  accent: AccentPreset;
  motion: MotionPref;
  signal: SignalPreset;
  uiFont: UiFont;
  dataFont: DataFont;
  density: DensityPref;
  sidebar: SidebarSide;
  controls: ControlsPos;
}

export const DEFAULT_PREFS: ThemePrefs = {
  theme: "dark",
  accent: "mono",
  motion: "on",
  signal: "classic",
  uiFont: "geist",
  dataFont: "jet",
  density: "comfortable",
  sidebar: "left",
  controls: "bottom",
};

export const ACCENT_PRESETS: { id: AccentPreset; label: string; swatch: string }[] = [
  { id: "mono", label: "Mono", swatch: "var(--text)" },
  { id: "green", label: "Green", swatch: "#3ecf8e" },
  { id: "blue", label: "Blue", swatch: "#5b9bf7" },
  { id: "amber", label: "Amber", swatch: "#cfa35a" },
  { id: "purple", label: "Purple", swatch: "#a679f0" },
  { id: "red", label: "Red", swatch: "#f0555d" },
];

/** Bullish/bearish ink pairs. Swatches are the dark-theme values; the CSS presets carry matching light-theme variants. */
export const SIGNAL_PRESETS: { id: SignalPreset; label: string; up: string; down: string }[] = [
  { id: "classic", label: "Green / Red", up: "#3ecf8e", down: "#f0555d" },
  { id: "ocean", label: "Blue / Orange", up: "#5b9bf7", down: "#f0a04a" },
  { id: "violet", label: "Purple / Amber", up: "#a679f0", down: "#cfa35a" },
  { id: "inverted", label: "Red / Green", up: "#f0555d", down: "#3ecf8e" },
];

export const UI_FONTS: { id: UiFont; label: string }[] = [
  { id: "geist", label: "Geist" },
  { id: "inter", label: "Inter" },
  { id: "grotesk", label: "Grotesk" },
];

export const DATA_FONTS: { id: DataFont; label: string }[] = [
  { id: "jet", label: "JetBrains" },
  { id: "plex", label: "Plex" },
  { id: "fira", label: "Fira" },
];

const KEYS = {
  theme: "trifekta:theme",
  accent: "trifekta:accent",
  motion: "trifekta:motion",
  signal: "trifekta:signal",
  uiFont: "trifekta:font-ui",
  dataFont: "trifekta:font-data",
  density: "trifekta:density",
  sidebar: "trifekta:sidebar",
  controls: "trifekta:controls",
} as const;
// Pre-rebrand keys - read as fallback so existing users keep their settings.
const LEGACY_THEME_KEY = "macropad:theme";
const LEGACY_ACCENT_KEY = "macropad:accent";

/** Fired on every save so layout-level consumers (sidebar side, controls bar) re-read prefs. */
export const PREFS_EVENT = "trifekta:prefs";

/** Inlined into a blocking <script> in layout.tsx so theme applies before first paint - keep in sync if this logic changes. */
export const THEME_INIT_SCRIPT = `(function(){try{var g=function(k){return localStorage.getItem(k)};var d=document.documentElement;var t=g(${JSON.stringify(
  KEYS.theme
)})||g(${JSON.stringify(LEGACY_THEME_KEY)});var a=g(${JSON.stringify(KEYS.accent)})||g(${JSON.stringify(
  LEGACY_ACCENT_KEY
)});if(t==="light")d.setAttribute("data-theme","light");if(a&&a!=="mono")d.setAttribute("data-accent",a);if(g(${JSON.stringify(
  KEYS.motion
)})==="off")d.setAttribute("data-motion","off");var s=g(${JSON.stringify(
  KEYS.signal
)});if(s&&s!=="classic")d.setAttribute("data-signal",s);var fu=g(${JSON.stringify(
  KEYS.uiFont
)});if(fu&&fu!=="geist")d.setAttribute("data-font-ui",fu);var fd=g(${JSON.stringify(
  KEYS.dataFont
)});if(fd&&fd!=="jet")d.setAttribute("data-font-data",fd);if(g(${JSON.stringify(
  KEYS.density
)})==="compact")d.setAttribute("data-density","compact");}catch(e){}})();`;

function pick<T extends string>(stored: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(stored ?? "") ? (stored as T) : fallback;
}

export function loadThemePrefs(): ThemePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  const g = (k: string) => localStorage.getItem(k);
  return {
    theme: (g(KEYS.theme) ?? g(LEGACY_THEME_KEY)) === "light" ? "light" : "dark",
    accent: pick(g(KEYS.accent) ?? g(LEGACY_ACCENT_KEY), ACCENT_PRESETS.map((p) => p.id), "mono"),
    motion: g(KEYS.motion) === "off" ? "off" : "on",
    signal: pick(g(KEYS.signal), SIGNAL_PRESETS.map((p) => p.id), "classic"),
    uiFont: pick(g(KEYS.uiFont), UI_FONTS.map((f) => f.id), "geist"),
    dataFont: pick(g(KEYS.dataFont), DATA_FONTS.map((f) => f.id), "jet"),
    density: g(KEYS.density) === "compact" ? "compact" : "comfortable",
    sidebar: g(KEYS.sidebar) === "right" ? "right" : "left",
    controls: g(KEYS.controls) === "top" ? "top" : "bottom",
  };
}

/** Attribute-valued prefs land on <html> for the CSS presets; layout prefs (sidebar, controls) are consumed in React via PREFS_EVENT. */
export function applyThemePrefs(prefs: ThemePrefs) {
  const root = document.documentElement;
  const set = (attr: string, value: string | null) => {
    if (value === null) root.removeAttribute(attr);
    else root.setAttribute(attr, value);
  };
  set("data-theme", prefs.theme === "light" ? "light" : null);
  set("data-accent", prefs.accent === "mono" ? null : prefs.accent);
  set("data-motion", prefs.motion === "off" ? "off" : null);
  set("data-signal", prefs.signal === "classic" ? null : prefs.signal);
  set("data-font-ui", prefs.uiFont === "geist" ? null : prefs.uiFont);
  set("data-font-data", prefs.dataFont === "jet" ? null : prefs.dataFont);
  set("data-density", prefs.density === "compact" ? "compact" : null);
}

export function saveThemePrefs(prefs: ThemePrefs) {
  try {
    (Object.keys(KEYS) as (keyof ThemePrefs)[]).forEach((k) => localStorage.setItem(KEYS[k], prefs[k]));
  } catch {
    // localStorage unavailable (private browsing etc.) - theme just won't persist
  }
  window.dispatchEvent(new CustomEvent<ThemePrefs>(PREFS_EVENT, { detail: prefs }));
}
