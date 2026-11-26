"use client";

import React from "react";
import { RefreshCw } from "lucide-react";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { ActivationFunnel, PlatformOverviewMetrics } from "@/domains/platform/services/platform-analytics.service";
import type { AgentHealth } from "@/domains/platform/services/agent-health.service";
import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import type { PlatformAuditLogRecord } from "@/types/platform";
import { usePlatformResource } from "../_lib/use-platform-resource";
import { usePlatformSession } from "../_lib/platform-session";
import { formatDhakaTime } from "../_lib/format";
import { CONSOLE_ROOT, canAccessPlatformPath } from "../_lib/platform-module-access";
import { PageHeader } from "../_components/PageHeader";
import { ResourceView } from "../_components/ResourceView";
import { AgentCard } from "../_components/control-tower/AgentCard";
import { AttentionDesk } from "../_components/control-tower/AttentionDesk";
import { AuditCard } from "../_components/control-tower/AuditCard";
import { ControlTowerSkeleton } from "../_components/control-tower/ControlTowerSkeleton";
import { GatesCard } from "../_components/control-tower/GatesCard";
import { ActivationCard, SignupsCard } from "../_components/control-tower/GrowthCard";
import { KpiRow } from "../_components/control-tower/KpiRow";
import { RailsCard } from "../_components/control-tower/RailsCard";
import { RevenueCard } from "../_components/control-tower/RevenueCard";
import { TodayCard } from "../_components/control-tower/TodayCard";
import { WorkspacesPanel } from "../_components/control-tower/WorkspacesPanel";
import type { SubscriptionRow } from "../_components/control-tower/control-tower-view";
import styles from "../_components/control-tower/control-tower.module.css";

const REFRESH_MS = 60_000;

export default function ControlTowerPage() {
  const { can, session } = usePlatformSession();
  const canReadAudit = can(PLATFORM_PERMISSIONS.AUDIT_READ);
  const canOpen = (path: string) => canAccessPlatformPath(`${CONSOLE_ROOT}${path}`, session.permissions);

  const overview = usePlatformResource<PlatformOverviewMetrics>("/api/v1/platform/overview", { refreshMs: REFRESH_MS });
  const attention = usePlatformResource<AttentionItem[]>("/api/v1/platform/attention", {
    refreshMs: REFRESH_MS,
    isEmpty: (items) => items.length === 0,
  });
  // Only splits the revenue by plan; the totals come from the overview
  const subscriptions = usePlatformResource<SubscriptionRow[]>(
    can(PLATFORM_PERMISSIONS.SUBSCRIPTION_READ) ? "/api/v1/platform/subscriptions" : null,
    { refreshMs: REFRESH_MS }
  );
  // Counts every workspace's products and orders, so it loads once and on Refresh; its cards say when
  const funnel = usePlatformResource<ActivationFunnel>("/api/v1/platform/analytics/funnel", { isEmpty: (f) => f.workspaces === 0 });
  const agents = usePlatformResource<AgentHealth>("/api/v1/platform/ai/agent-health", {
    refreshMs: REFRESH_MS,
    isEmpty: (h) => h.turns === 0,
  });
  // One read feeds today's timeline and the table
  const audit = usePlatformResource<PlatformAuditLogRecord[]>(canReadAudit ? "/api/v1/platform/audit?limit=30" : null, {
    refreshMs: REFRESH_MS,
    isEmpty: (logs) => logs.length === 0,
  });

  const reloadAll = () => {
    for (const resource of [overview, attention, subscriptions, funnel, agents, audit]) resource.reload();
  };

  const fetchedAt = overview.state.kind === "ready" ? overview.state.fetchedAt : undefined;
  // null = not known (still loading, failed or forbidden); an empty list is a real "nothing"
  const items = attention.state.kind === "ready" ? attention.state.data : attention.state.kind === "empty" ? [] : null;

  return (
    <>
      <PageHeader
        title="Control Tower"
        description="Live platform state from the overview, attention and audit APIs. Refreshes every minute while this tab is visible."
        fetchedAt={fetchedAt}
        actions={
          <>
            {fetchedAt && <span className={styles.updated}>Updated {formatDhakaTime(new Date(fetchedAt))} · refreshes every minute</span>}
            <Button variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={reloadAll}>
              Refresh
            </Button>
          </>
        }
      />

      {overview.state.kind === "loading" ? (
        <ControlTowerSkeleton />
      ) : overview.state.kind === "ready" ? (
        <div className={styles.board}>
          <div className={styles.lead}>
            <KpiRow overview={overview.state.data} items={items} />
            <SignupsCard state={funnel.state} onRetry={funnel.reload} />
            <RevenueCard
              financials={overview.state.data.financials}
              subscriptions={subscriptions.state.kind === "ready" ? subscriptions.state.data : null}
              canOpenBilling={canOpen("/billing")}
            />
          </div>
          <WorkspacesPanel tenants={overview.state.data.tenants} />
          <AttentionDesk state={attention.state} onRetry={attention.reload} />
          <div className={styles.side}>
            <GatesCard overview={overview.state.data} items={items} permissions={session.permissions} />
            <TodayCard canRead={canReadAudit} state={audit.state} onRetry={audit.reload} />
          </div>
          <AgentCard state={agents.state} onRetry={agents.reload} />
          <ActivationCard state={funnel.state} onRetry={funnel.reload} canOpenInsights={canOpen("/insights")} />
          <RailsCard rails={overview.state.data.provider_health} />
          <AuditCard canRead={canReadAudit} state={audit.state} onRetry={audit.reload} />
        </div>
      ) : (
        <BentoCard span={12} className={styles.card}>
          <ResourceView
            state={overview.state}
            onRetry={reloadAll}
            resource="the platform overview"
            emptyFigure="no-data"
            emptyTitle="No overview data"
            emptyDescription="The overview API returned nothing to show."
            renderReady={() => null}
          />
        </BentoCard>
      )}
    </>
  );
}
