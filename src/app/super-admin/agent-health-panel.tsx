"use client";

/**
 * Super-admin "Agent health" view (FX-81): the customer agent across every workspace, last 24 hours. Every figure comes
 * from GET /api/v1/platform/ai/agent-health (recorded runs and tool calls); a missing figure shows a dash, never zero.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { platformFetch, readPlatformError } from "./platform-client";
import styles from "./super-admin.module.css";

interface AgentHealth {
  generated_at: string;
  turns: number;
  turns_per_hour: Array<{ hour: string; turns: number }>;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  cost_usd_last_24h: number;
  cost_usd_by_day: Array<{ day: string; cost_usd: number }>;
  cost_by_tenant: Array<{ tenant_id: string; tenant_name: string; turns: number; cost_usd: number }>;
  cache_hit_share: number | null;
  tool_calls: number;
  tool_failure_rate: number | null;
  guard_triggers: Record<string, number>;
  handoff_rate: number | null;
  escalation_reasons: Record<string, number>;
  model_calls: number;
  throttled_429: number;
  throttled_rate: number | null;
  embeddings?: { calls: number; failures: number; failure_rate: number | null; since: string };
}

const dash = (v: number | null | undefined, unit = "") => (typeof v === "number" ? `${v.toLocaleString()}${unit}` : "—");
const usd = (v: number) => `$${v.toFixed(4)}`;

export function AgentHealthPanel() {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await platformFetch("/api/v1/platform/ai/agent-health");
      if (!res.ok) throw new Error(await readPlatformError(res, "Agent health couldn't be loaded."));
      const body = (await res.json()) as { data: AgentHealth };
      setHealth(body.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stat = (label: string, value: string) => (
    <div className={`${styles.bentoCard} ${styles.col3}`}>
      <span className={styles.cardMetaLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
  const table = (title: string, head: string[], rows: Array<Array<string>>, empty: string) => (
    <div className={`${styles.bentoCard} ${styles.col6}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleArea}>
          <h3 className={styles.cardTitle}>{title}</h3>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={styles.emptyText}>{empty}</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.join("|")}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className={styles.filterBar}>
        <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} />
          <span>{loading ? "Loading…" : "Refresh"}</span>
        </button>
        {health && <span className={styles.cardMetaLabel}>Last 24 hours · generated {new Date(health.generated_at).toLocaleString()}</span>}
      </div>
      {error && <p className={styles.emptyText} role="alert">{error}</p>}
      {health && (
        <div className={styles.bentoGrid}>
          {stat("Turns (24 h)", dash(health.turns))}
          {stat("Latency p50 / p95", `${dash(health.latency_p50_ms, " ms")} / ${dash(health.latency_p95_ms, " ms")}`)}
          {stat("Cost (24 h)", usd(health.cost_usd_last_24h))}
          {stat("Cache-hit share", dash(health.cache_hit_share, "%"))}
          {stat("Handoff rate", dash(health.handoff_rate, "%"))}
          {stat("Tool failure rate", `${dash(health.tool_failure_rate, "%")} of ${health.tool_calls}`)}
          {stat("Provider 429s", `${health.throttled_429} (${dash(health.throttled_rate, "%")})`)}
          {stat("Model calls", dash(health.model_calls))}
          {health.embeddings && stat("Embedding failures (this server)", `${health.embeddings.failures} of ${health.embeddings.calls} (${dash(health.embeddings.failure_rate, "%")})`)}
          {table("Guard triggers", ["Guard", "Turns"], Object.entries(health.guard_triggers).map(([k, v]) => [k, String(v)]), "No guard has fired.")}
          {table("Escalation reasons", ["Reason", "Handoffs"], Object.entries(health.escalation_reasons).map(([k, v]) => [k, String(v)]), "No handoffs.")}
          {table("Cost per workspace (24 h)", ["Workspace", "Turns", "Cost"], health.cost_by_tenant.map((t) => [t.tenant_name, String(t.turns), usd(t.cost_usd)]), "No turns.")}
          {table("Cost per day", ["Day", "Cost"], health.cost_usd_by_day.map((d) => [d.day, usd(d.cost_usd)]), "No turns.")}
          {table("Turns per hour", ["Hour (UTC)", "Turns"], health.turns_per_hour.filter((h) => h.turns > 0).map((h) => [h.hour.slice(5, 16).replace("T", " "), String(h.turns)]), "No turns in the last 24 hours.")}
        </div>
      )}
    </div>
  );
}
