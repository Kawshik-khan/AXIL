"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Target, Wallet, TrendingUp, MousePointerClick, MessageSquare, ShoppingBag, UserCheck, Banknote, RefreshCw, PlugZap } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { LoadingSkeleton, ErrorState, PermissionDenied } from "@/components/ui/States/States";
import { StatTile, ColumnChart, HBarChart, Funnel, compact, money, pct } from "@/components/insights/Charts";
import { SuggestionPanel } from "@/components/insights/SuggestionPanel";
import styles from "@/components/insights/insights.module.css";
import { isMetaPopupMessage, pickerUrlOf, startMetaLoginPopup } from "@/components/social/meta-login-popup";
import type { AdsReport, AdCampaignRow } from "@/domains/social/insights/ad-performance.service";

const RANGES = [7, 14, 30, 90] as const;
type DailyMetric = "spend" | "revenue" | "clicks" | "messages" | "purchases" | "impressions";
const DAILY_LABEL: Record<DailyMetric, string> = {
  spend: "Spend",
  revenue: "Ad revenue",
  clicks: "Clicks",
  messages: "Messages started",
  purchases: "Purchases",
  impressions: "Impressions",
};
type SortKey = "spend" | "roas" | "messages_started" | "purchases" | "ctr" | "orders";

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function sortValue(c: AdCampaignRow, key: SortKey): number {
  if (key === "orders") return c.commerce.orders;
  return (c[key] as number | null) ?? -1;
}

export default function AdManagerPage() {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<AdsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId?: string; status?: number } | null>(null);
  const [metric, setMetric] = useState<DailyMetric>("spend");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [selected, setSelected] = useState<string | null>(null);
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // "Connect ads": the Facebook popup reports back here, then the merchant picks the ad account
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isMetaPopupMessage(event)) return;
      router.push(pickerUrlOf(event.data));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  const connectAds = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await startMetaLoginPopup(["ads"]);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Could not start Facebook sign-in.");
    } finally {
      setConnecting(false);
    }
  };

  const load = useCallback(async (range: number, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/marketing/ads?days=${range}${refresh ? "&refresh=1" : ""}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: json?.error?.message || "Could not load ad performance.", requestId: json?.error?.request_id, status: res.status });
        return;
      }
      setReport(json.data as AdsReport);
    } catch {
      setError({ message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const campaigns = useMemo(
    () => (report ? [...report.campaigns].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey)) : []),
    [report, sortKey]
  );
  const selectedCampaign = report?.campaigns.find((c) => c.id === selected) ?? null;

  if (error?.status === 403) return <PermissionDenied resource="ad performance" requiredPermission="marketing.read" />;

  const cur = report?.account?.currency ?? "USD";
  const t = report?.totals ?? null;
  const c = report?.commerce;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <Target size={22} /> Ad Manager
          </h1>
          <p className={styles.pageSubtitle}>Spend, clicks, messages and ad revenue from Meta, joined with the customers and orders CommerceOS saw from those ads.</p>
        </div>
        <div className={styles.headerControls}>
          <div className={styles.segmented} role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button key={r} type="button" className={days === r ? styles.segmentActive : ""} onClick={() => setDays(r)} aria-pressed={days === r}>
                {r}D
              </button>
            ))}
          </div>
          <button type="button" className={styles.ghostButton} onClick={() => load(days, true)} disabled={loading} aria-label="Refresh from Meta">
            <RefreshCw size={14} className={loading ? styles.spin : ""} /> Refresh
          </button>
        </div>
      </header>

      {report && (
        <div className={styles.sourceRow}>
          <span className={`${styles.sourceChip} ${styles[`source${report.status}`]}`} title={report.message ?? undefined}>
            <span className={styles.dot} aria-hidden />
            Meta ads
            {report.account ? ` · ${report.account.name ?? report.account.id} · ${report.account.currency}` : ""}
            {report.status !== "LIVE" && ` · ${report.status === "ERROR" ? "error" : "not connected"}`}
          </span>
          <span className={`${styles.sourceChip} ${styles.sourceLIVE}`}>
            <span className={styles.dot} aria-hidden />
            CommerceOS attribution · {c?.currency}
          </span>
          <span className={styles.muted}>Updated {new Date(report.fetched_at).toLocaleTimeString()}</span>
        </div>
      )}

      {loading && !report ? (
        <LoadingSkeleton lines={8} />
      ) : error ? (
        <ErrorState message={error.message} requestId={error.requestId} onRetry={() => load(days)} />
      ) : report && c ? (
        <>
          {report.status !== "LIVE" && (
            <div className={`${styles.banner} ${report.status === "ERROR" ? styles.bannerError : ""}`}>
              <PlugZap size={18} />
              <div>
                <strong>{report.status === "ERROR" ? "Meta returned an error" : "Ad account not connected"}</strong>
                <p>{report.message}</p>
                {connectError && <p role="alert">{connectError}</p>}
              </div>
              <button type="button" className={styles.primaryButton} onClick={connectAds} disabled={connecting}>
                {connecting ? "Opening Facebook…" : report.status === "ERROR" ? "Reconnect ads" : "Connect ads"}
              </button>
            </div>
          )}

          <div className={styles.statGrid}>
            <StatTile label="Ad spend" icon={<Wallet size={14} />} value={money(t?.spend, cur)} hint={t ? `CPM ${money(t.cpm, cur)}` : "Meta"} active={metric === "spend"} onClick={t ? () => setMetric("spend") : undefined} />
            <StatTile label="Ad revenue" icon={<Banknote size={14} />} value={money(t?.purchase_value, cur)} hint="Purchase value reported by Meta" active={metric === "revenue"} onClick={t ? () => setMetric("revenue") : undefined} />
            <StatTile label="ROAS" icon={<TrendingUp size={14} />} value={t?.roas === null || !t ? "—" : `${t.roas}×`} hint="Ad revenue ÷ spend" tone={t?.roas == null ? "default" : t.roas >= 1 ? "good" : "bad"} />
            <StatTile label="Clicks" icon={<MousePointerClick size={14} />} value={compact(t?.clicks)} hint={t ? `CTR ${pct(t.ctr)} · CPC ${money(t.cpc, cur)}` : undefined} active={metric === "clicks"} onClick={t ? () => setMetric("clicks") : undefined} />
            <StatTile label="Messages" icon={<MessageSquare size={14} />} value={compact(t?.messages_started)} hint={t ? `${money(t.cost_per_message, cur)} per conversation` : undefined} active={metric === "messages"} onClick={t ? () => setMetric("messages") : undefined} />
            <StatTile label="Purchases" icon={<ShoppingBag size={14} />} value={compact(t?.purchases)} hint={t ? `${money(t.cost_per_purchase, cur)} each` : undefined} active={metric === "purchases"} onClick={t ? () => setMetric("purchases") : undefined} />
            <StatTile label="Became customers" icon={<UserCheck size={14} />} value={compact(c.converted_customers)} hint={`${pct(c.conversion_rate)} of ${c.ad_customers} who messaged from an ad`} />
            <StatTile
              label="Order revenue"
              icon={<Banknote size={14} />}
              value={money(c.revenue, c.currency)}
              hint={report.commerce_roas !== null ? `${report.commerce_roas}× spend · ${c.orders} orders` : `${c.orders} orders in CommerceOS`}
              tone={report.commerce_roas === null ? "default" : report.commerce_roas >= 1 ? "good" : "bad"}
            />
          </div>

          <BentoGrid>
            {t && (
              <BentoCard
                span={8}
                title={`${DAILY_LABEL[metric]} by day`}
                subtitle={metric === "spend" || metric === "revenue" ? `In ${cur}` : "From Meta Ads"}
                action={
                  <select className={styles.select} value={metric} onChange={(e) => setMetric(e.target.value as DailyMetric)} aria-label="Daily metric">
                    {(Object.keys(DAILY_LABEL) as DailyMetric[]).map((m) => (
                      <option key={m} value={m}>
                        {DAILY_LABEL[m]}
                      </option>
                    ))}
                  </select>
                }
              >
                {report.daily.length === 0 ? (
                  <p className={styles.muted}>No delivery in this period.</p>
                ) : (
                  <ColumnChart
                    ariaLabel={`${DAILY_LABEL[metric]} per day`}
                    format={(v) => (metric === "spend" || metric === "revenue" ? money(v, cur) : compact(Math.round(v)))}
                    points={report.daily.map((d) => ({
                      label: shortDate(d.date),
                      value: d[metric],
                      detail: `${money(d.spend, cur)} spend · ${d.clicks} clicks · ${d.messages} messages`,
                    }))}
                  />
                )}
              </BentoCard>
            )}

            <BentoCard span={t ? 4 : 6} title="Ad funnel" subtitle="From seeing the ad to placing an order">
              <Funnel
                steps={[
                  { label: "Impressions", value: t?.impressions ?? null, source: "Meta" },
                  { label: "Clicks", value: t?.clicks ?? null, source: "Meta" },
                  { label: "Conversations started", value: t ? t.messages_started : null, source: "Meta" },
                  { label: "People who messaged", value: c.ad_customers, source: "CommerceOS" },
                  { label: "Became customers", value: c.converted_customers, source: "CommerceOS" },
                  { label: "Orders", value: c.orders, source: "CommerceOS" },
                ]}
              />
            </BentoCard>

            {t && report.campaigns.length > 0 && (
              <BentoCard span={6} title="ROAS by campaign" subtitle="Ad revenue ÷ spend. Click a campaign for details.">
                <HBarChart
                  selected={selected}
                  onSelect={(key) => setSelected((s) => (s === key ? null : key))}
                  reference={{ value: 1, label: "ROAS 1.0 = break-even" }}
                  rows={report.campaigns.slice(0, 10).map((camp) => ({
                    key: camp.id,
                    label: camp.name,
                    sub: `${money(camp.spend, cur)} spend`,
                    value: camp.roas ?? 0,
                    display: camp.roas === null ? "—" : `${camp.roas}×`,
                    tone: camp.roas === null ? "default" : camp.roas >= 1 ? "good" : "bad",
                  }))}
                />
              </BentoCard>
            )}

            {t && report.campaigns.length > 0 && (
              <BentoCard span={6} title="Spend share" subtitle="Where the budget goes">
                <HBarChart
                  selected={selected}
                  onSelect={(key) => setSelected((s) => (s === key ? null : key))}
                  rows={report.campaigns.slice(0, 10).map((camp) => ({
                    key: camp.id,
                    label: camp.name,
                    sub: `${camp.messages_started} msgs · ${camp.purchases} purchases`,
                    value: camp.spend,
                    display: `${t.spend ? Math.round((camp.spend / t.spend) * 100) : 0}%`,
                  }))}
                />
              </BentoCard>
            )}

            {selectedCampaign && (
              <BentoCard span={12} title={selectedCampaign.name} subtitle={[selectedCampaign.objective, selectedCampaign.status].filter(Boolean).join(" · ")}
                action={<button type="button" className={styles.ghostButton} onClick={() => setSelected(null)}>Close</button>}
              >
                <div className={styles.statGrid}>
                  <StatTile label="Spend" value={money(selectedCampaign.spend, cur)} />
                  <StatTile label="Impressions" value={compact(selectedCampaign.impressions)} hint={`Frequency ${selectedCampaign.frequency ?? "—"}`} />
                  <StatTile label="CTR" value={pct(selectedCampaign.ctr)} hint={`${compact(selectedCampaign.clicks)} clicks`} />
                  <StatTile label="CPM" value={money(selectedCampaign.cpm, cur)} />
                  <StatTile label="Messages" value={compact(selectedCampaign.messages_started)} hint={`${money(selectedCampaign.cost_per_message, cur)} each`} />
                  <StatTile label="Purchases" value={compact(selectedCampaign.purchases)} hint={money(selectedCampaign.purchase_value, cur)} />
                  <StatTile label="ROAS" value={selectedCampaign.roas === null ? "—" : `${selectedCampaign.roas}×`} tone={selectedCampaign.roas == null ? "default" : selectedCampaign.roas >= 1 ? "good" : "bad"} />
                  <StatTile label="CommerceOS orders" value={compact(selectedCampaign.commerce.orders)} hint={money(selectedCampaign.commerce.revenue, c.currency)} />
                </div>
              </BentoCard>
            )}

            {t && (
              <BentoCard span={7} title="Campaigns"
                action={
                  <select className={styles.select} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort campaigns">
                    <option value="spend">Highest spend</option>
                    <option value="roas">Best ROAS</option>
                    <option value="messages_started">Most messages</option>
                    <option value="purchases">Most purchases</option>
                    <option value="orders">Most CommerceOS orders</option>
                    <option value="ctr">Best CTR</option>
                  </select>
                }
              >
                {campaigns.length === 0 ? (
                  <p className={styles.muted}>No campaign delivered in this period.</p>
                ) : (
                  <div className={styles.tableScroll}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>Campaign</th>
                          <th>Spend</th>
                          <th>CTR</th>
                          <th>Msgs</th>
                          <th>Purch.</th>
                          <th>ROAS</th>
                          <th>Orders*</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map((camp) => (
                          <tr key={camp.id} className={selected === camp.id ? styles.rowSelected : styles.rowClickable} onClick={() => setSelected(camp.id)}>
                            <td>
                              <span className={styles.caption}>{camp.name}</span>
                              <small>{[camp.objective, camp.status].filter(Boolean).join(" · ")}</small>
                            </td>
                            <td>{money(camp.spend, cur)}</td>
                            <td>{pct(camp.ctr)}</td>
                            <td>{compact(camp.messages_started)}</td>
                            <td>{compact(camp.purchases)}</td>
                            <td className={camp.roas === null ? "" : camp.roas >= 1 ? styles.toneGood : styles.toneBad}>{camp.roas === null ? "—" : `${camp.roas}×`}</td>
                            <td>{camp.commerce.orders}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className={styles.chartNote}>* Orders placed in CommerceOS by customers whose conversation came from this campaign.</p>
                  </div>
                )}
              </BentoCard>
            )}

            <BentoCard span={t ? 5 : 6} title="AI suggestions" subtitle="Rules over your numbers, plus an AI action plan">
              <SuggestionPanel
                suggestions={report.suggestions}
                coachEndpoint="/api/v1/marketing/ads/coach"
                days={days}
                highlightScope={selected}
                emptyText="No issues found in this period."
              />
            </BentoCard>

            <BentoCard span={12} title="Customers from ads (CommerceOS)" subtitle="Conversations that started from an ad, and the orders those customers placed after">
              {c.by_source.length === 0 ? (
                <p className={styles.muted}>
                  No conversations in this period carry an ad referral. Messenger and WhatsApp click-to-chat ads attach one automatically when the channel is connected.
                </p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Campaign / ad</th>
                        <th>Conversations</th>
                        <th>Customers</th>
                        <th>Orders</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.by_source.map((s) => (
                        <tr key={s.key}>
                          <td>{s.label}</td>
                          <td>{s.conversations}</td>
                          <td>{s.customers}</td>
                          <td>{s.orders}</td>
                          <td>{money(s.revenue, c.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BentoCard>
          </BentoGrid>
        </>
      ) : null}
    </div>
  );
}
