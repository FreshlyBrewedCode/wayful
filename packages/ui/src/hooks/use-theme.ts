import { useCallback, useEffect, useState } from "react";

const KEY = "wayful-viewer-theme";

export type Theme = "light" | "dark";

const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const stored = (): Theme | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
};

/**
 * Appearance follows `prefers-color-scheme` until the user overrides it; the
 * override is persisted client-side. `index.html` applies the same decision
 * before first paint so there is no flash.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => stored() ?? systemTheme());
  const [overridden, setOverridden] = useState(() => stored() !== null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (overridden) return;
    const list = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setThemeState(systemTheme());
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [overridden]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setOverridden(true);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // A viewer that cannot remember the choice is still a working viewer.
    }
  }, []);

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
