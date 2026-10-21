"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { ActivationFunnel, PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import type { FraudRadarTelemetry } from "@/domains/rto/rto-scoring.service";
import type { ConnectionsService } from "@/domains/connectors/connections.service";

type ConnectionHealth = ReturnType<typeof ConnectionsService.platformHealth>;
const PROVIDER_NAME: Record<string, string> = { meta_graph: "Facebook & Instagram", whatsapp_cloud: "WhatsApp" };
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { usePlatformSession } from "../../_lib/platform-session";
import { formatCount, formatMoney, formatPercent, isPresent, NO_DATA } from "../../_lib/format";
import { PageHeader } from "../../_components/PageHeader";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import styles from "../../super-admin.module.css";

function Bar({ label, value, of }: { label: string; value: number; of: number }) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <li className={styles.listRow}>
      <span className={styles.rowMain}>
        <span>{label}</span>
        <span className={styles.progressTrack} aria-label={`${pct}%`}>
          <span className={styles.progressFill} style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className={styles.mono}>
        {formatCount(value)} · {of > 0 ? `${pct}%` : "—"}
      </span>
    </li>
  );
}

export default function InsightsPage() {
  const { can } = usePlatformSession();
  const overview = usePlatformResource<PlatformOverviewMetrics>(can(PLATFORM_PERMISSIONS.PLATFORM_READ) ? "/api/v1/platform/overview" : null);
  const funnel = usePlatformResource<ActivationFunnel>("/api/v1/platform/analytics/funnel", { isEmpty: (f) => f.workspaces === 0 });
  const rto = usePlatformResource<FraudRadarTelemetry>("/api/v1/platform/rto/radar", { isEmpty: (r) => r.screened_orders_count === 0 });
  const connections = usePlatformResource<ConnectionHealth>(
    can(PLATFORM_PERMISSIONS.INTEGRATION_READ) ? "/api/v1/platform/connections/health" : null
  );

  return (
    <>
      <PageHeader
        title="Insights"
        description="Commerce across the platform, the activation funnel and the cross-tenant RTO network. Every figure is computed from stored records on read."
        fetchedAt={funnel.state.kind === "ready" ? funnel.state.fetchedAt : undefined}
        actions={
          <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => { overview.reload(); funnel.reload(); rto.reload(); connections.reload(); }}>
            Refresh
          </Button>
        }
      />

      {overview.state.kind === "ready" && (
        <BentoGrid>
          {(() => {
            const v = overview.state.data.commerce_velocity;
            const has = v.total_orders_count > 0;
            return (
              <>
                <BentoCard span={3}>
                  <div className={styles.kpiLabel}>GMV (all workspaces)</div>
                  <div className={has ? styles.kpiValue : styles.kpiValueMuted}>{has ? formatMoney(v.total_gmv_bdt, "BDT") : NO_DATA}</div>
                  <div className={styles.kpiSub}>Excludes cancelled orders</div>
                </BentoCard>
                <BentoCard span={3}>
                  <div className={styles.kpiLabel}>Orders</div>
                  <div className={styles.kpiValue}>{formatCount(v.total_orders_count)}</div>
                </BentoCard>
                <BentoCard span={3}>
                  <div className={styles.kpiLabel}>Average order</div>
                  <div className={has ? styles.kpiValue : styles.kpiValueMuted}>{has ? formatMoney(v.avg_order_value_bdt, "BDT") : NO_DATA}</div>
                </BentoCard>
                <BentoCard span={3}>
                  <div className={styles.kpiLabel}>Cash on delivery</div>
                  <div className={isPresent(v.cod_percentage) ? styles.kpiValue : styles.kpiValueMuted}>{formatPercent(v.cod_percentage, 0)}</div>
                  <div className={styles.kpiSub}>{isPresent(v.digital_payment_percentage) ? `${formatPercent(v.digital_payment_percentage, 0)} digital` : ""}</div>
                </BentoCard>
              </>
            );
          })()}
        </BentoGrid>
      )}

      <BentoGrid>
        <BentoCard span={6} title="Activation funnel" subtitle="Workspaces (archived excluded) by how far they got">
          <ResourceView
            state={funnel.state}
            onRetry={funnel.reload}
            resource="the activation funnel"
            emptyFigure="no-data"
            emptyTitle="No workspaces yet"
            emptyDescription="The funnel fills as workspaces sign up, add products and take orders."
            renderReady={(f) => (
              <ul className={styles.list}>
                <Bar label="Signed up" value={f.workspaces} of={f.workspaces} />
                <Bar label="Added a product" value={f.with_product} of={f.workspaces} />
                <Bar label="Received an order" value={f.with_order} of={f.workspaces} />
                <Bar label="Paying" value={f.paying} of={f.workspaces} />
              </ul>
            )}
          />
        </BentoCard>
        <BentoCard span={6} title="Weekly signups" subtitle="Last 12 weeks (Monday start) and how many of each week have ordered">
          <ResourceView
            state={funnel.state}
            onRetry={funnel.reload}
            resource="signup cohorts"
            emptyFigure="no-data"
            emptyTitle="No signups"
            emptyDescription="Cohorts appear when workspaces are created."
            renderReady={(f) => {
              const max = Math.max(0, ...f.weekly_cohorts.map((c) => c.signups));
              return max === 0 ? (
                <span className={styles.muted}>No signups in the last 12 weeks.</span>
              ) : (
                <ul className={styles.list}>
                  {f.weekly_cohorts.map((c) => (
                    <Bar key={c.week_start} label={`Week of ${c.week_start} · ${formatCount(c.with_order)} ordered`} value={c.signups} of={max} />
                  ))}
                </ul>
              );
            }}
          />
        </BentoCard>

        <BentoCard span={12} title="RTO network" subtitle="Blinded cross-tenant delivery reputation (no PII crosses workspaces)">
          <ResourceView
            state={rto.state}
            onRetry={rto.reload}
            resource="the RTO network"
            emptyFigure="network-empty"
            emptyTitle="No orders screened yet"
            emptyDescription="The network fills as COD orders are scored for return risk."
            renderReady={(r) => (
              <div className={styles.sectionGap}>
                <dl className={styles.definition}>
                  <dt>Orders screened</dt>
                  <dd>{formatCount(r.screened_orders_count)}</dd>
                  <dt>Flagged high risk</dt>
                  <dd>{formatCount(r.high_risk_flagged_count)}</dd>
                  <dt>Advance fees collected</dt>
                  <dd>{formatMoney(r.advance_fees_collected_bdt, "BDT")}</dd>
                  <dt>Network delivery success</dt>
                  <dd>{formatPercent(r.network_delivery_success_rate)}</dd>
                  <dt>Network return rate</dt>
                  <dd>{formatPercent(r.network_rto_rate)}</dd>
                  <dt>Reputation profiles</dt>
                  <dd>{formatCount(r.tracked_reputation_profiles_count)}</dd>
                </dl>
                {r.district_risk_distribution.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>District</th>
                          <th>Risk</th>
                          <th className={styles.numeric}>Samples</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.district_risk_distribution.map((d) => (
                          <tr key={d.district}>
                            <td>{d.district}</td>
                            <td>
                              <StatusPill status={d.risk_level} tone={d.risk_level === "ELEVATED" ? "bad" : d.risk_level === "MODERATE" ? "warn" : "ok"} />
                            </td>
                            <td className={styles.numeric}>{formatCount(d.sample_count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          />
        </BentoCard>

        <BentoCard span={12} title="Sign-in connections" subtitle="Facebook, Instagram and WhatsApp connections across workspaces: counts only, from the 6-hourly health check">
          <ResourceView
            state={connections.state}
            onRetry={connections.reload}
            resource="connection health"
            emptyFigure="network-empty"
            emptyTitle="No sign-in connections yet"
            emptyDescription="Workspaces appear here once they connect Facebook or WhatsApp."
            renderReady={(h) => (
              <div className={styles.sectionGap}>
                <dl className={styles.definition}>
                  <dt>Meta app configured</dt>
                  <dd><StatusPill status={h.app.meta_app_configured ? "YES" : "NO"} tone={h.app.meta_app_configured ? "ok" : "bad"} /></dd>
                  <dt>WhatsApp sign-up configured</dt>
                  <dd><StatusPill status={h.app.whatsapp_signup_configured ? "YES" : "NO"} tone={h.app.whatsapp_signup_configured ? "ok" : "warn"} /></dd>
                  <dt>APP_URL is https</dt>
                  <dd><StatusPill status={h.app.app_url_https ? "YES" : "NO"} tone={h.app.app_url_https ? "ok" : "bad"} /></dd>
                  <dt>Workspaces needing reconnect</dt>
                  <dd>{formatCount(h.workspaces_needing_reauth)}</dd>
                  <dt>Expiring within 7 days</dt>
                  <dd>{formatCount(h.expiring_within_7_days)}</dd>
                </dl>
                {h.by_provider.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Provider</th>
                          <th className={styles.numeric}>Connections</th>
                          <th>By status</th>
                          <th>Health codes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {h.by_provider.map((p) => (
                          <tr key={p.provider_id}>
                            <td>{PROVIDER_NAME[p.provider_id] ?? p.provider_id}</td>
                            <td className={styles.numeric}>{formatCount(p.total)}</td>
                            <td>{Object.entries(p.by_status).map(([k, v]) => `${k} ${v}`).join(" · ") || NO_DATA}</td>
                            <td>{Object.entries(p.by_health_code).map(([k, v]) => `${k} ${v}`).join(" · ") || NO_DATA}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          />
        </BentoCard>
      </BentoGrid>
    </>
  );
}
