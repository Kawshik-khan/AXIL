"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, RefreshCw, ShoppingCart, TrendingDown, UserX, Users } from "lucide-react";
import { useSection } from "@/components/dashboard/dashboard-data";
import { SectionState } from "@/components/dashboard/SectionState";
import { PERMISSIONS } from "@/lib/permissions";
import type { Audience, GrowthRecommendation } from "@/types/growth";
import { GrowthShell, Panel } from "./_components/GrowthShell";
import { STAGES, formatBdt, formatCount, type LifecycleStage } from "./_components/growth-format";
import styles from "./_components/Growth.module.css";

interface GrowthOverview {
  audiences_count: number;
  lifecycle_distribution: Partial<Record<LifecycleStage, number>>;
  growth_insights_count: number;
  growth_recommendations_count: number;
  top_recommendations: GrowthRecommendation[];
}

interface CartOverview {
  total_recovered_revenue_bdt: number;
  total_abandoned_revenue_bdt: number;
  cart_recovery_rate_pct: number;
  active_abandoned_carts_count: number;
}

const RISK_CHIP: Record<string, string> = {
  LOW: styles.chipOk,
  MEDIUM: styles.chipWarn,
  HIGH: styles.chipRisk,
  CRITICAL: styles.chipRisk,
};

/** Growth overview: cart recovery, customer stages, suggestions and the largest audiences. Every figure is from the API. */
export default function GrowthOverviewPage() {
  const overview = useSection<GrowthOverview>("/api/v1/growth/overview");
  const carts = useSection<CartOverview>("/api/v1/marketing/overview");
  const audiences = useSection<{ audiences: Audience[] }>("/api/v1/growth/audiences");

  const reloadAll = () => {
    overview.reload();
    carts.reload();
    audiences.reload();
  };
  const busy = overview.loading || carts.loading || audiences.loading;

  const dist = overview.data?.lifecycle_distribution ?? {};
  const atRisk = (dist.AT_RISK ?? 0) + (dist.DORMANT ?? 0);
  const c = carts.data;

  let cartNote = "Could not load";
  if (c) cartNote = `${c.cart_recovery_rate_pct}% of ${formatBdt(c.total_abandoned_revenue_bdt)} abandoned`;
  else if (carts.status === 403) cartNote = `Needs ${PERMISSIONS.MARKETING_READ}`;
  else if (carts.loading) cartNote = "Loading";

  return (
    <GrowthShell
      active="/growth"
      title="Growth"
      subtitle="Win back carts, spot customers who are slipping away, and group buyers you want to reach."
      counts={{ "/growth/audiences": audiences.data?.audiences.length ?? null, "/growth/cart-recovery": c?.active_abandoned_carts_count ?? null }}
      actions={
        <button type="button" className={styles.ghost} onClick={reloadAll} disabled={busy}>
          <RefreshCw size={14} className={busy ? styles.spin : undefined} /> Refresh
        </button>
      }
    >
      {/* Key figures: the lime tile is cart recovery, the one number this area moves directly */}
      <section className={styles.kpiRow} aria-label="Key figures">
        <Link href="/growth/cart-recovery" className={`${styles.card} ${styles.kpi} ${styles.kpiLead}`} aria-busy={carts.loading}>
          <span className={styles.kpiLabel}>Recovered from abandoned carts</span>
          <span>
            <span className={styles.kpiValue}>{c ? formatBdt(c.total_recovered_revenue_bdt) : "—"}</span>
            <span className={styles.note}>{cartNote}</span>
            {c && (
              <span className={styles.meter} aria-hidden style={{ display: "block" }}>
                <span className={styles.meterFill} style={{ width: `${Math.min(100, c.cart_recovery_rate_pct)}%`, display: "block" }} />
              </span>
            )}
          </span>
        </Link>
        <Tile href="/growth/cart-recovery" label="Open carts" value={c ? formatCount(c.active_abandoned_carts_count) : "—"} note="Not checked out yet" />
        <Tile
          href="/growth/audiences"
          label="Audiences"
          value={overview.data ? formatCount(overview.data.audiences_count) : "—"}
          note="Saved customer groups"
        />
        <Tile
          href="/customers/lifecycle"
          label="At risk or dormant"
          value={overview.data ? formatCount(atRisk) : "—"}
          note="Ordering less, or not at all"
        />
      </section>

      <div className={styles.split}>
        <Panel
          title="Where your customers are"
          note="Every customer sits in one stage, worked out from their orders."
          actions={
            <Link href="/customers/lifecycle" className={styles.linkPill}>
              Lifecycle <ArrowUpRight size={12} />
            </Link>
          }
        >
          <SectionState section={overview} resource="customer stages" permission={PERMISSIONS.MARKETING_READ}>
            {(data) => <StageBars distribution={data.lifecycle_distribution} />}
          </SectionState>
        </Panel>

        <Panel lilac title="Needs attention" note="Where a message or an offer could bring an order back.">
          <AttentionQueue
            loading={overview.loading && carts.loading}
            openCarts={c?.active_abandoned_carts_count ?? null}
            atRisk={overview.data ? dist.AT_RISK ?? 0 : null}
            dormant={overview.data ? dist.DORMANT ?? 0 : null}
          />
        </Panel>
      </div>

      <div className={styles.halves}>
        <Panel title="✦ Growth suggestions" note="Ideas from your order history. Nothing is sent without you.">
          <SectionState section={overview} resource="growth suggestions" permission={PERMISSIONS.MARKETING_READ}>
            {(data) =>
              data.top_recommendations.length === 0 ? (
                <p className={styles.empty}>No suggestions yet. They appear once there are enough orders to learn from.</p>
              ) : (
                <div className={styles.suggestions}>
                  {data.top_recommendations.slice(0, 3).map((rec) => (
                    <article key={rec.id} className={styles.suggestion}>
                      <span className={styles.suggestionIcon} aria-hidden>
                        ✦
                      </span>
                      <div className={styles.suggestionText}>
                        <strong>{rec.title}</strong>
                        <span className={styles.note}>{rec.expected_impact?.summary || rec.strategy}</span>
                        <span className={styles.suggestionMeta}>
                          <span className={`${styles.chip} ${styles.chipLilac}`}>{rec.target_audience_name}</span>
                          <span className={styles.chip}>{rec.recommended_channel.replace(/_/g, " ").toLowerCase()}</span>
                          <span className={`${styles.chip} ${RISK_CHIP[rec.action_risk_level] ?? ""}`}>{String(rec.action_risk_level).toLowerCase()} risk</span>
                          {typeof rec.expected_impact?.projected_revenue_bdt === "number" && (
                            <span className={styles.chip}>+{formatBdt(rec.expected_impact.projected_revenue_bdt)} projected</span>
                          )}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )
            }
          </SectionState>
        </Panel>

        <Panel
          title="Largest audiences"
          note="Sizes are counted against your customers now."
          actions={
            <Link href="/growth/audiences" className={styles.linkPill}>
              All audiences <ArrowUpRight size={12} />
            </Link>
          }
        >
          <SectionState section={audiences} resource="audiences" permission={PERMISSIONS.MARKETING_READ}>
            {(data) =>
              data.audiences.length === 0 ? (
                <p className={styles.empty}>
                  No audiences yet. <Link href="/growth/audiences">Create your first one</Link>.
                </p>
              ) : (
                <AudienceList audiences={data.audiences} />
              )
            }
          </SectionState>
        </Panel>
      </div>
    </GrowthShell>
  );
}

function Tile({ href, label, value, note }: { href: string; label: string; value: string; note: string }) {
  return (
    <Link href={href} className={`${styles.card} ${styles.kpi}`}>
      <span className={styles.kpiLabel}>{label}</span>
      <span>
        <span className={styles.kpiValue}>{value}</span>
        <span className={styles.note}>{note}</span>
      </span>
    </Link>
  );
}

function StageBars({ distribution }: { distribution: Partial<Record<LifecycleStage, number>> }) {
  const total = STAGES.reduce((sum, s) => sum + (distribution[s.key] ?? 0), 0);
  if (total === 0) return <p className={styles.empty}>No customers yet. Stages appear after the first orders.</p>;
  const max = Math.max(...STAGES.map((s) => distribution[s.key] ?? 0), 1);
  const buying = STAGES.filter((s) => !s.slipping);

  const row = (s: (typeof STAGES)[number]) => {
    const count = distribution[s.key] ?? 0;
    const share = Math.round((count / total) * 100);
    const fill = s.slipping ? styles.trackWarn : "";
    return (
      <div key={s.key} className={styles.stageRow} title={`${s.label}: ${count.toLocaleString()} customers (${share}%)`}>
        <span className={styles.stageName}>
          {s.label}
          <span className={styles.stageHint}>{s.hint}</span>
        </span>
        <span className={styles.track} aria-hidden>
          <span className={`${styles.trackFill} ${fill}`} style={{ width: `${Math.max(count > 0 ? 2 : 0, (count / max) * 100)}%`, display: "block" }} />
        </span>
        <span className={styles.stageCount}>{count.toLocaleString()}</span>
        <span className={styles.stageShare}>{share}%</span>
      </div>
    );
  };

  return (
    <div className={styles.stages}>
      <span className={styles.stageGroup}>Buying</span>
      {buying.map(row)}
      <span className={styles.stageGroup}>Slipping away</span>
      {STAGES.filter((s) => s.slipping).map(row)}
    </div>
  );
}

interface AttentionProps {
  loading: boolean;
  openCarts: number | null;
  atRisk: number | null;
  dormant: number | null;
}

function AttentionQueue({ loading, openCarts, atRisk, dormant }: AttentionProps) {
  if (loading) return <p className={styles.note}>Loading…</p>;
  const rows = [
    { href: "/growth/cart-recovery", icon: <ShoppingCart size={16} />, title: "Open carts", text: "Send a WhatsApp nudge", count: openCarts },
    { href: "/customers/lifecycle", icon: <TrendingDown size={16} />, title: "At-risk customers", text: "Ordering less than before", count: atRisk },
    { href: "/growth/audiences", icon: <UserX size={16} />, title: "Dormant customers", text: "Group them to win them back", count: dormant },
  ].filter((r) => typeof r.count === "number" && r.count > 0);

  if (rows.length === 0)
    return (
      <div className={styles.queue}>
        <div className={styles.queueRow}>
          <span className={styles.queueIcon}>
            <Users size={16} />
          </span>
          <span className={styles.queueText}>
            <strong>Nothing needs you</strong>
            No open carts and no customers slipping away.
          </span>
        </div>
      </div>
    );

  return (
    <div className={styles.queue}>
      {rows.map((r) => (
        <Link key={r.title} href={r.href} className={styles.queueRow}>
          <span className={styles.queueIcon}>{r.icon}</span>
          <span className={styles.queueText}>
            <strong>{r.title}</strong>
            {r.text}
          </span>
          <span className={styles.queueCount}>{(r.count ?? 0).toLocaleString()}</span>
        </Link>
      ))}
    </div>
  );
}

function AudienceList({ audiences }: { audiences: Audience[] }) {
  const top = [...audiences].sort((a, b) => (b.estimated_size ?? 0) - (a.estimated_size ?? 0)).slice(0, 5);
  const max = Math.max(...top.map((a) => a.estimated_size ?? 0), 1);
  return (
    <div className={styles.audienceList}>
      {top.map((a) => (
        <div key={a.id} className={styles.audienceRow}>
          <span style={{ minWidth: 0 }}>
            <strong>{a.name}</strong>
            <span className={styles.note}>{a.type.toLowerCase()}</span>
          </span>
          <span className={styles.track} aria-hidden>
            <span className={styles.trackFill} style={{ width: `${((a.estimated_size ?? 0) / max) * 100}%`, display: "block" }} />
          </span>
          <span className={styles.audienceSize}>{(a.estimated_size ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
