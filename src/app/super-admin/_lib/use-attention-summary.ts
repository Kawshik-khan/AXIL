"use client";

import { useEffect, useState } from "react";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import { platformRequest } from "./platform-client";

const REFRESH_MS = 60_000;

/**
 * The attention list for the sidebar's counts, read every minute while the tab is visible. null while unknown, not
 * permitted or failed: the sidebar then shows no counts rather than zeros.
 */
export function useAttentionSummary(enabled: boolean): AttentionItem[] | null {
  const [items, setItems] = useState<AttentionItem[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      platformRequest<AttentionItem[]>("/api/v1/platform/attention")
        .then((res) => {
          if (!cancelled) setItems(Array.isArray(res.data) ? res.data : null);
        })
        .catch(() => {
          if (!cancelled) setItems(null);
        });
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return items;
}
