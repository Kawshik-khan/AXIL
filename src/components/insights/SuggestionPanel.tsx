"use client";

import React, { useState } from "react";
import { AlertOctagon, AlertTriangle, Lightbulb, Info, Sparkles, RefreshCw } from "lucide-react";
import styles from "./insights.module.css";

export interface Suggestion {
  id: string;
  severity: "critical" | "warning" | "opportunity" | "info";
  title: string;
  detail: string;
  action: string;
  evidence: string;
  scope?: string;
}

const SEVERITY: Record<Suggestion["severity"], { label: string; icon: React.ReactNode; className: string }> = {
  critical: { label: "Fix now", icon: <AlertOctagon size={14} />, className: "sevCritical" },
  warning: { label: "Improve", icon: <AlertTriangle size={14} />, className: "sevWarning" },
  opportunity: { label: "Opportunity", icon: <Lightbulb size={14} />, className: "sevOpportunity" },
  info: { label: "Note", icon: <Info size={14} />, className: "sevInfo" },
};

/** Renders the model's Markdown bullets as text: **bold** spans only, never HTML. */
function AdviceText({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim()).filter(Boolean);
  return (
    <ul className={styles.adviceList}>
      {lines.map((line, i) => (
        <li key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <React.Fragment key={j}>{part}</React.Fragment>
          )}
        </li>
      ))}
    </ul>
  );
}

export const SuggestionPanel: React.FC<{
  suggestions: Suggestion[];
  coachEndpoint: string;
  days: number;
  highlightScope?: string | null;
  emptyText: string;
}> = ({ suggestions, coachEndpoint, days, highlightScope, emptyText }) => {
  const [filter, setFilter] = useState<Suggestion["severity"] | "all">("all");
  const [coach, setCoach] = useState<{ advice: string; provider: string; demo: boolean } | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);

  const counts = suggestions.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.severity]: (acc[s.severity] ?? 0) + 1 }), {});
  const visible = suggestions
    .filter((s) => filter === "all" || s.severity === filter)
    .sort((a, b) => Number(b.scope === highlightScope && !!highlightScope) - Number(a.scope === highlightScope && !!highlightScope));

  const askCoach = async () => {
    setCoachLoading(true);
    setCoachError(null);
    try {
      const res = await fetch(coachEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "The AI coach is unavailable right now.");
      setCoach({ advice: json.data.advice, provider: json.data.provider, demo: Boolean(json.data.demo) });
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : "The AI coach is unavailable right now.");
    } finally {
      setCoachLoading(false);
    }
  };

  return (
    <div className={styles.suggestions}>
      <div className={styles.chipRow} role="tablist" aria-label="Filter suggestions">
        {(["all", "critical", "warning", "opportunity", "info"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`${styles.chip} ${filter === key ? styles.chipActive : ""}`}
            onClick={() => setFilter(key)}
            disabled={key !== "all" && !counts[key]}
          >
            {key === "all" ? "All" : SEVERITY[key].label} {key === "all" ? suggestions.length : counts[key] ?? 0}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className={styles.muted}>{emptyText}</p>
      ) : (
        <ul className={styles.suggestionList}>
          {visible.map((s) => {
            const sev = SEVERITY[s.severity];
            return (
              <li key={s.id} className={`${styles.suggestion} ${highlightScope && s.scope === highlightScope ? styles.suggestionHighlight : ""}`}>
                <span className={`${styles.sevBadge} ${styles[sev.className]}`}>
                  {sev.icon}
                  {sev.label}
                </span>
                <h4>{s.title}</h4>
                <p>{s.detail}</p>
                <p className={styles.suggestionAction}>
                  <strong>Do this:</strong> {s.action}
                </p>
                <small className={styles.evidence}>Based on: {s.evidence}</small>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.coach}>
        <div className={styles.coachHead}>
          <span>
            <Sparkles size={16} /> AI strategist
          </span>
          <button type="button" className={styles.primaryButton} onClick={askCoach} disabled={coachLoading}>
            {coachLoading ? <RefreshCw size={14} className={styles.spin} /> : <Sparkles size={14} />}
            {coach ? "Ask again" : "Get AI action plan"}
          </button>
        </div>
        {coachError && <p className={styles.errorText}>{coachError}</p>}
        {coach ? (
          <>
            {coach.demo && <p className={styles.demoNote}>Demo AI: offline keyword model, not a real analysis.</p>}
            <AdviceText text={coach.advice} />
            <small className={styles.evidence}>
              Written by {coach.provider} from the numbers on this page. Check figures above before acting.
            </small>
          </>
        ) : (
          !coachError && <p className={styles.muted}>Get a prioritised 7-day plan written from this period&apos;s numbers.</p>
        )}
      </div>
    </div>
  );
};
