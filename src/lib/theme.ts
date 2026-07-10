export type ThemeMode = "dark" | "light";
export type AccentPreset = "mono" | "green" | "blue" | "amber" | "purple" | "red";

export const ACCENT_PRESETS: { id: AccentPreset; label: string; swatch: string }[] = [
  { id: "mono", label: "Mono", swatch: "var(--text)" },
  { id: "green", label: "Green", swatch: "#3ecf8e" },
  { id: "blue", label: "Blue", swatch: "#5b9bf7" },
  { id: "amber", label: "Amber", swatch: "#cfa35a" },
  { id: "purple", label: "Purple", swatch: "#a679f0" },
  { id: "red", label: "Red", swatch: "#f0555d" },
];

const THEME_KEY = "trifekta:theme";
const ACCENT_KEY = "trifekta:accent";
// Pre-rebrand keys - read as fallback so existing users keep their settings.
const LEGACY_THEME_KEY = "macropad:theme";
const LEGACY_ACCENT_KEY = "macropad:accent";

/** Inlined into a blocking <script> in layout.tsx so theme applies before first paint - keep in sync if this logic changes. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)})||localStorage.getItem(${JSON.stringify(
  LEGACY_THEME_KEY
)});var a=localStorage.getItem(${JSON.stringify(ACCENT_KEY)})||localStorage.getItem(${JSON.stringify(
  LEGACY_ACCENT_KEY
)});if(t==="light")document.documentElement.setAttribute("data-theme","light");if(a&&a!=="mono")document.documentElement.setAttribute("data-accent",a);}catch(e){}})();`;

export function loadThemePrefs(): { theme: ThemeMode; accent: AccentPreset } {
  if (typeof window === "undefined") return { theme: "dark", accent: "mono" };
  const storedTheme = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY);
  const theme = storedTheme === "light" ? "light" : "dark";
  const storedAccent = localStorage.getItem(ACCENT_KEY) ?? localStorage.getItem(LEGACY_ACCENT_KEY);
  const accent = (ACCENT_PRESETS.find((p) => p.id === storedAccent)?.id ?? "mono") as AccentPreset;
  return { theme, accent };
}

export function applyThemePrefs(theme: ThemeMode, accent: AccentPreset) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  if (accent === "mono") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", accent);
}

export function saveThemePrefs(theme: ThemeMode, accent: AccentPreset) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // localStorage unavailable (private browsing etc.) - theme just won't persist
  }
}
