"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Light / dark theme for the merchant dashboard. It reuses the dark token set and component overrides that the platform
 * console already has: they all key on `html[data-console-theme="dark"]` (tokens.css), so this provider sets that same
 * attribute while the dashboard is mounted and removes it on unmount. The choice is remembered in this browser, under
 * its own key so it never changes the operator's console theme.
 */

export type MerchantTheme = "light" | "dark";

const STORAGE_KEY = "commerceos.merchant.theme";
const DEFAULT_THEME: MerchantTheme = "light";

const ThemeContext = createContext<{ theme: MerchantTheme; toggle: () => void }>({
  theme: DEFAULT_THEME,
  toggle: () => undefined,
});

function storedTheme(): MerchantTheme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // storage blocked (private mode, policies): fall back without failing
  }
}

export function MerchantThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<MerchantTheme>(DEFAULT_THEME);

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
      const next: MerchantTheme = current === "dark" ? "light" : "dark";
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

export const useMerchantTheme = () => useContext(ThemeContext);
