"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AgentActivity } from "@/components/dashboard/AgentActivity";
import { AttentionPanel } from "@/components/dashboard/AttentionPanel";
import { ChannelMix } from "@/components/dashboard/ChannelMix";
import { DivisionsPanel } from "@/components/dashboard/DivisionsPanel";
import { IntelligencePanel } from "@/components/dashboard/IntelligencePanel";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { Segmented } from "@/components/dashboard/Panel";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { StockPanel } from "@/components/dashboard/StockPanel";
import {
  CURRENCIES,
  isCurrencyCode,
  useSection,
  type CurrencyCode,
  type DashboardMetrics,
  type DashboardSession,
  type IntelligenceOverview,
} from "@/components/dashboard/dashboard-data";
import { LaunchChecklist } from "@/components/onboarding/LaunchChecklist";
import type { AgentRun } from "@/types/ai";
import type { FinancialMetrics } from "@/types/analytics";
import styles from "@/components/dashboard/Dashboard.module.css";

type Range = "7D" | "30D" | "90D";
const RANGE_DAYS: Record<Range, number> = { "7D": 7, "30D": 30, "90D": 90 };
const RANGE_OPTIONS = (Object.keys(RANGE_DAYS) as Range[]).map((value) => ({ value, label: `${RANGE_DAYS[value]} days` }));

/** The shop dashboard. Every number comes from these endpoints (FX-39); a section without data shows its own state. */
export default function DashboardPage() {
  const [range, setRange] = useState<Range>("30D");
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>("BDT");
  const [channel, setChannel] = useState<string | null>(null);

  const session = useSection<DashboardSession>("/api/v1/auth/session");
  const metrics = useSection<{ metrics: DashboardMetrics }>("/api/v1/reports/dashboard");
  const financials = useSection<{ financials: FinancialMetrics; preset: Range }>(`/api/v1/analytics/financials?preset=${range}`);
  const runs = useSection<AgentRun[]>("/api/v1/ai/runs");
  const intelligence = useSection<IntelligenceOverview>("/api/v1/intelligence/overview");

  const shopCurrency = session.data?.tenant?.currency;
  useEffect(() => {
    if (isCurrencyCode(shopCurrency)) setCurrencyCode(shopCurrency);
  }, [shopCurrency]);

  const currency = CURRENCIES[currencyCode];
  // While another period loads, the figures on screen are still the last one's: label them with theirs
  const rangeDays = RANGE_DAYS[financials.data?.preset ?? range];

  return (
    <div className={styles.root}>
      {/* New shops: finish setup, then the launch checklist (nothing for older workspaces) */}
      <LaunchChecklist />

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Sales, orders and delivery for {session.data?.tenant?.name || "your shop"}.</p>
        </div>
        <div className={styles.controls}>
          <Segmented<Range>
            label="Period for revenue, sales and margin"
            value={range}
            options={RANGE_OPTIONS}
            onChange={setRange}
            busy={financials.loading}
          />
          <label className={styles.currency}>
            Currency
            <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value as CurrencyCode)}>
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code}
                </option>
              ))}
            </select>
          </label>
          <Link href="/orders" className={styles.primary}>
            <Plus size={16} aria-hidden="true" />
            Create order
          </Link>
        </div>
      </header>

      {session.data?.role === "DEV" && (
        <div className={styles.devNotice}>
          <span>
            <strong>Developer role.</strong> Agent gateway, policy telemetry and the tool registry are in AI Agents.
          </span>
          <Link href="/agents" className={styles.linkPill}>
            Open AI Agents
          </Link>
        </div>
      )}

      <div className={styles.topGrid}>
        <div className={styles.topLeft}>
          <KpiRow metrics={metrics} financials={financials} rangeDays={rangeDays} currency={currency} />
          <div className={styles.charts}>
            <SalesChart financials={financials} rangeDays={rangeDays} currency={currency} />
            <ChannelMix metrics={metrics} currency={currency} selected={channel} onSelect={setChannel} />
          </div>
        </div>
        <AttentionPanel metrics={metrics} />
      </div>

      <div className={styles.threeGrid}>
        <IntelligencePanel intelligence={intelligence} />
        <DivisionsPanel metrics={metrics} currency={currency} />
        <AgentActivity runs={runs} />
      </div>

      <div className={styles.bottomGrid}>
        <RecentOrders metrics={metrics} currency={currency} channel={channel} onClearChannel={() => setChannel(null)} />
        <StockPanel metrics={metrics} />
      </div>
    </div>
  );
}
