"use client";

import { useEffect, useState } from "react";
import { platformRequest } from "./platform-client";

const REFRESH_MS = 60_000;

/** The number of PENDING approval requests, for the top-bar indicator; null while unknown or not permitted. */
export function usePendingApprovals(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      platformRequest<unknown[]>("/api/v1/platform/approvals?status=PENDING&limit=100")
        .then((res) => {
          if (!cancelled) setCount(Array.isArray(res.data) ? res.data.length : null);
        })
        .catch(() => {
          if (!cancelled) setCount(null);
        });
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return count;
}
