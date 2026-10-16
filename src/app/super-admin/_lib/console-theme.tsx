"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Light / dark theme for the platform console. The console starts dark; the operator's choice is remembered in this
 * browser. The theme is a `data-console-theme` attribute on <html> (the dark token values live in tokens.css), set
 * only while the console is open and removed when it closes, so merchant pages are never affected.
 */

export type ConsoleTheme = "light" | "dark";

const STORAGE_KEY = "commerceos.console.theme";
const DEFAULT_THEME: ConsoleTheme = "dark";

const ThemeContext = createContext<{ theme: ConsoleTheme; toggle: () => void }>({ theme: DEFAULT_THEME, toggle: () => undefined });

function storedTheme(): ConsoleTheme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // storage blocked (private mode, policies): fall back without failing
  }
}

export function ConsoleThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ConsoleTheme>(DEFAULT_THEME);

  // Read the stored choice once mounted (the server render cannot know it).
  useEffect(() => {
    setTheme(storedTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-console-theme", theme);
    return () => root.removeAttribute("data-console-theme");
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: ConsoleTheme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // not remembered, but the switch still works for this visit
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useConsoleTheme = () => useContext(ThemeContext);
