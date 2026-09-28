"use client";

import React, { useEffect, useState } from "react";

type AiMode = "LIVE" | "DEMO" | "NOT_CONFIGURED";

/**
 * Says when AI answers don't come from a model (FX-32): "Demo AI (offline)" for the keyword demo, "AI not configured"
 * when there's no provider. Renders nothing for a live provider or when the status can't be read.
 */
export function AiModeBadge({ style }: { style?: React.CSSProperties }) {
  const [mode, setMode] = useState<AiMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/ai/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.data?.mode) setMode(json.data.mode as AiMode);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!mode || mode === "LIVE") return null;
  return (
    <span
      title={mode === "DEMO" ? "Answers come from an offline keyword demo, not a language model." : "Set LLM_BASE_URL to connect an AI provider."}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        background: "var(--color-warning)",
        color: "var(--color-text-primary)",
        ...style,
      }}
    >
      {mode === "DEMO" ? "Demo AI (offline)" : "AI not configured"}
    </span>
  );
}
