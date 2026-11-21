"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/payments/api";

export interface SetupGuideItem {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  required: boolean;
  href: string;
}

export interface SetupGuideStatus {
  needs_onboarding: boolean;
  show_checklist: boolean;
  checklist_collapsed: boolean;
  setup_finished: boolean;
  required_done: number;
  required_total: number;
  checklist: SetupGuideItem[];
  done_count: number;
}

/** Fired after the guide is folded or unfolded, so the card and the navigation entry stay in step. */
const CHANGED_EVENT = "commerceos:setup-guide-changed";

/**
 * The setup guide's status from GET /api/v1/onboarding (every item computed from real data on the server) and the
 * fold/unfold action. null while loading, or when the status can't be read (the guide then simply doesn't show).
 */
export function useSetupGuide() {
  const [status, setStatus] = useState<SetupGuideStatus | null>(null);

  const load = useCallback(async () => {
    const result = await api<SetupGuideStatus>("/api/v1/onboarding");
    if (result.ok && result.data) setStatus(result.data);
  }, []);

  useEffect(() => {
    void load();
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<SetupGuideStatus>).detail;
      if (next) setStatus(next);
    };
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHANGED_EVENT, onChange);
  }, [load]);

  /** Folds (true) or unfolds (false) the guide; returns false when the server refused. */
  const setCollapsed = useCallback(async (collapsed: boolean) => {
    const result = await api<SetupGuideStatus>("/api/v1/onboarding", { method: "PATCH", json: { checklist_collapsed: collapsed } });
    if (!result.ok || !result.data) return false;
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: result.data }));
    return true;
  }, []);

  return { status, setCollapsed, reload: load };
}
