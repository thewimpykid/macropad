"use client";

import { useEffect } from "react";
import { applyThemePrefs, loadThemePrefs } from "@/lib/theme";

/*
 * Re-applies the stored theme/accent once hydration is done. The blocking
 * script in layout.tsx sets the attributes before first paint, but if React
 * recovers from any hydration mismatch it recreates <html> from JSX props
 * and silently wipes them - after which nothing re-applied the preference
 * and the site reverted to dark on every visit. Mounted globally so
 * marketing pages (which have no SettingsPanel) are covered too.
 */
export default function ThemeSync() {
  useEffect(() => {
    applyThemePrefs(loadThemePrefs());
  }, []);
  return null;
}
