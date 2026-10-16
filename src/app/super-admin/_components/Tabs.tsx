"use client";

import React, { useCallback, useEffect, useState } from "react";
import styles from "../super-admin.module.css";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Hidden when false (e.g. the role can't open it). */
  visible?: boolean;
}

/** The active tab, kept in `?tab=` so a view can be linked and survives reloads. */
export function useTab<T extends string>(tabs: readonly TabDef<T>[], fallback: T): [T, (t: T) => void] {
  const visible = tabs.filter((t) => t.visible !== false);
  const [tab, setTabState] = useState<T>(fallback);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    const match = visible.find((t) => t.id === fromUrl);
    setTabState(match ? match.id : visible.some((t) => t.id === fallback) ? fallback : visible[0]?.id ?? fallback);
    // Only on mount: later changes come from setTab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = useCallback((t: T) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  }, []);

  return [tab, setTab];
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: readonly TabDef<T>[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs
        .filter((t) => t.visible !== false)
        .map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className={`${styles.tab} ${active === t.id ? styles.tabActive : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}
