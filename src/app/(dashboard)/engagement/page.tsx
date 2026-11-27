"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Heart, RefreshCw } from "lucide-react";
import { LoadingSkeleton, EmptyState, ErrorState, PermissionDenied } from "@/components/ui/States/States";
import { compact } from "@/components/insights/Charts";
import { CommentTriggers } from "@/components/social/CommentTriggers";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { PerformanceView } from "@/components/engagement/PerformanceView";
import { PostSalesView } from "@/components/engagement/PostSalesView";
import styles from "@/components/engagement/Engagement.module.css";
import type { EngagementReport } from "@/domains/social/insights/engagement-analysis.service";

const RANGES = [7, 14, 30, 90] as const;
type View = "performance" | "sales" | "triggers";
const VIEWS: Array<{ key: View; label: string }> = [
  { key: "performance", label: "Performance" },
  { key: "sales", label: "Posts that sold" },
  { key: "triggers", label: "Comment to DM" },
];

type LoadError = { message: string; requestId?: string; status?: number };

export default function EngagementPage() {
  const [days, setDays] = useState<number>(30);
  const [view, setView] = useState<View>("performance");
  const [report, setReport] = useState<EngagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const load = useCallback(async (range: number, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/social/engagement?days=${range}${refresh ? "&refresh=1" : ""}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: json?.error?.message || "Could not load engagement data.", requestId: json?.error?.request_id, status: res.status });
        return;
      }
      setReport(json.data as EngagementReport);
    } catch {
      setError({ message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const live = report?.sources.filter((s) => s.status === "LIVE") ?? [];

  const performance = () => {
    if (error?.status === 403) return <PermissionDenied resource="engagement analytics" requiredPermission="social.analytics.read" />;
    if (loading && !report) return <LoadingSkeleton lines={8} />;
    if (error) return <ErrorState message={error.message} requestId={error.requestId} onRetry={() => load(days)} />;
    if (!report) return null;
    if (live.length === 0) {
      return (
        <EmptyState
          icon={<Heart size={28} />}
          title={report.sources.some((s) => s.status === "ERROR") ? "Meta returned an error" : "Connect Facebook or Instagram"}
          description={report.sources.find((s) => s.message)?.message ?? "Connect the Meta Graph connector to analyse your posts."}
          actionText="Open Connector Hub"
          onAction={() => (window.location.href = "/connector?category=SOCIAL_ADS")}
        />
      );
    }
    return <PerformanceView report={report} days={days} />;
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Engagement</h1>
          <p className={styles.subtitle}>How your Facebook and Instagram posts perform, and the comments that turn into orders.</p>
        </div>
        <div className={styles.controls}>
          {view !== "triggers" && (
            <div className={styles.segmented} role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r} type="button" className={styles.segment} onClick={() => setDays(r)} aria-pressed={days === r}>
                  {r}D
                </button>
              ))}
            </div>
          )}
          <button type="button" className={styles.ghost} onClick={() => load(days, true)} disabled={loading} aria-label="Refresh from Meta">
            <RefreshCw size={14} className={loading ? styles.spin : ""} /> Refresh from Meta
          </button>
        </div>
      </header>

      <div className={styles.bar}>
        <div className={styles.segmented} role="tablist" aria-label="Engagement views">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`engagement-tab-${v.key}`}
              aria-controls="engagement-panel"
              aria-selected={view === v.key}
              className={styles.segment}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {report && (
          <div className={styles.sources}>
            {report.sources.map((s) => (
              <span key={s.platform} className={styles.source} title={s.message ?? undefined}>
                <span className={`${styles.dot} ${s.status === "LIVE" ? styles.dotLive : s.status === "ERROR" ? styles.dotError : ""}`} aria-hidden="true" />
                <BrandIcon brand={s.platform === "FACEBOOK" ? "facebook" : "instagram"} size={16} />
                {s.account_name ?? (s.platform === "FACEBOOK" ? "Facebook" : "Instagram")}
                {s.followers !== null ? ` · ${compact(s.followers)} followers` : ""}
                {s.status !== "LIVE" && ` · ${s.status === "ERROR" ? "error" : "not connected"}`}
              </span>
            ))}
            {report.fetched_at && <span className={styles.muted}>Updated {new Date(report.fetched_at).toLocaleTimeString()}</span>}
          </div>
        )}
      </div>
      {report?.truncated && view !== "triggers" && (
        <p className={styles.muted}>Showing the latest 100 posts per platform; pick a shorter range for full totals.</p>
      )}

      <div id="engagement-panel" role="tabpanel" aria-labelledby={`engagement-tab-${view}`} className={styles.root}>
        {view === "performance" && performance()}
        {view === "sales" && <PostSalesView days={days} posts={report?.posts ?? []} onOpenTriggers={() => setView("triggers")} />}
        {view === "triggers" && <CommentTriggers />}
      </div>
    </div>
  );
}
