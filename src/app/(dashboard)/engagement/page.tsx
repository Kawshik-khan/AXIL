"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, PlayCircle, Users, ThumbsUp, MessageCircle, Share2, Bookmark, Percent, RefreshCw, ExternalLink, Heart } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { LoadingSkeleton, EmptyState, ErrorState, PermissionDenied } from "@/components/ui/States/States";
import { StatTile, ColumnChart, HBarChart, CompositionBar, TimingHeatmap, compact, pct } from "@/components/insights/Charts";
import { SuggestionPanel } from "@/components/insights/SuggestionPanel";
import { CommentTriggers } from "@/components/social/CommentTriggers";
import styles from "@/components/insights/insights.module.css";
import type { EngagementReport, ContentPost } from "@/domains/social/insights/engagement-analysis.service";

const RANGES = [7, 14, 30, 90] as const;
type DailyMetric = "engagements" | "impressions" | "likes" | "comments" | "shares" | "posts";
const DAILY_LABEL: Record<DailyMetric, string> = {
  engagements: "Engagements",
  impressions: "Impressions / views",
  likes: "Likes & reactions",
  comments: "Comments",
  shares: "Shares",
  posts: "Posts published",
};
type SortKey = "created_at" | "engagements" | "engagement_rate" | "reach" | "comments";
const FORMAT_LABEL: Record<string, string> = { PHOTO: "Photo", VIDEO: "Video", REEL: "Reel", CAROUSEL: "Carousel", TEXT: "Text", LINK: "Link", OTHER: "Other" };

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function EngagementPage() {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<EngagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; requestId?: string; status?: number } | null>(null);
  const [metric, setMetric] = useState<DailyMetric>("engagements");
  const [platform, setPlatform] = useState<"ALL" | "FACEBOOK" | "INSTAGRAM">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("engagements");
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

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

  const posts = useMemo(() => {
    if (!report) return [] as ContentPost[];
    return report.posts
      .filter((p) => platform === "ALL" || p.platform === platform)
      .filter((p) => !selectedFormat || p.format === selectedFormat)
      .sort((a, b) => {
        if (sortKey === "created_at") return b.created_at.localeCompare(a.created_at);
        return ((b[sortKey] as number | null) ?? -1) - ((a[sortKey] as number | null) ?? -1);
      })
      .slice(0, 25);
  }, [report, platform, sortKey, selectedFormat]);

  if (error?.status === 403) return <PermissionDenied resource="engagement analytics" requiredPermission="social.analytics.read" />;

  const live = report?.sources.filter((s) => s.status === "LIVE") ?? [];
  const t = report?.totals;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <Heart size={22} /> Engagement Analysis
          </h1>
          <p className={styles.pageSubtitle}>How your Facebook and Instagram posts perform: impressions, views, likes, comments and shares.</p>
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
          {report.sources.map((s) => (
            <span key={s.platform} className={`${styles.sourceChip} ${styles[`source${s.status}`]}`} title={s.message ?? undefined}>
              <span className={styles.dot} aria-hidden />
              {s.platform === "FACEBOOK" ? "Facebook" : "Instagram"}
              {s.account_name ? ` · ${s.account_name}` : ""}
              {s.followers !== null ? ` · ${compact(s.followers)} followers` : ""}
              {s.status !== "LIVE" && ` · ${s.status === "ERROR" ? "error" : "not connected"}`}
            </span>
          ))}
          {report.fetched_at && <span className={styles.muted}>Updated {new Date(report.fetched_at).toLocaleTimeString()}</span>}
          {report.truncated && <span className={styles.muted}>Showing the latest 100 posts per platform; pick a shorter range for full totals.</span>}
        </div>
      )}

      {loading && !report ? (
        <LoadingSkeleton lines={8} />
      ) : error ? (
        <ErrorState message={error.message} requestId={error.requestId} onRetry={() => load(days)} />
      ) : report && live.length === 0 ? (
        <EmptyState
          icon={<Heart size={28} />}
          title={report.sources.some((s) => s.status === "ERROR") ? "Meta returned an error" : "Connect Facebook or Instagram"}
          description={report.sources.find((s) => s.message)?.message ?? "Connect the Meta Graph connector to analyse your posts."}
          actionText="Open Connector Hub"
          onAction={() => (window.location.href = "/connector?category=SOCIAL_ADS")}
        />
      ) : report && t ? (
        <>
          <div className={styles.statGrid}>
            <StatTile label="Impressions" icon={<Eye size={14} />} value={compact(t.impressions)} hint={t.impressions === null ? "Not reported by Meta" : `${t.posts} posts`} active={metric === "impressions"} onClick={() => setMetric("impressions")} />
            <StatTile label="Views" icon={<PlayCircle size={14} />} value={compact(t.views)} hint={t.views === null ? "Not reported by Meta" : "Video & media views"} />
            <StatTile label="Reach" icon={<Users size={14} />} value={compact(t.reach)} hint="Unique accounts" />
            <StatTile label="Likes" icon={<ThumbsUp size={14} />} value={compact(t.likes)} hint="Likes & reactions" active={metric === "likes"} onClick={() => setMetric("likes")} />
            <StatTile label="Comments" icon={<MessageCircle size={14} />} value={compact(t.comments)} active={metric === "comments"} onClick={() => setMetric("comments")} />
            <StatTile label="Shares" icon={<Share2 size={14} />} value={compact(t.shares)} active={metric === "shares"} onClick={() => setMetric("shares")} />
            <StatTile label="Saves" icon={<Bookmark size={14} />} value={compact(t.saves)} hint={t.saves === null ? "Instagram only" : undefined} />
            <StatTile label="Engagement rate" icon={<Percent size={14} />} value={pct(t.engagement_rate)} hint={`${compact(t.engagements)} engagements`} active={metric === "engagements"} onClick={() => setMetric("engagements")} />
          </div>

          <BentoGrid>
            <BentoCard
              span={8}
              title={`${DAILY_LABEL[metric]} by day`}
              subtitle="By publish date (Dhaka). Click a tile above to switch metric."
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
              <ColumnChart
                ariaLabel={`${DAILY_LABEL[metric]} per day`}
                format={(v) => compact(Math.round(v))}
                points={report.daily.map((d) => ({
                  label: shortDate(d.date),
                  value: metric === "impressions" ? d.impressions : d[metric],
                  detail: `${d.posts} post${d.posts === 1 ? "" : "s"} · ${d.engagements} engagements`,
                }))}
              />
            </BentoCard>

            <BentoCard span={4} title="Engagement mix" subtitle="What people do with your posts">
              <CompositionBar
                parts={[
                  { label: "Likes", value: t.likes },
                  { label: "Comments", value: t.comments },
                  { label: "Shares", value: t.shares },
                  { label: "Saves", value: t.saves },
                ]}
              />
              {report.sources.filter((s) => s.totals).length > 1 && (
                <table className={styles.miniTable}>
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>Posts</th>
                      <th>Eng.</th>
                      <th>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources
                      .filter((s) => s.totals)
                      .map((s) => (
                        <tr key={s.platform}>
                          <td>{s.platform === "FACEBOOK" ? "Facebook" : "Instagram"}</td>
                          <td>{s.totals?.posts}</td>
                          <td>{compact(s.totals?.engagements)}</td>
                          <td>{pct(s.totals?.engagement_rate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </BentoCard>

            <BentoCard span={6} title="Which formats work" subtitle="Average engagements per post. Click to filter the posts below.">
              {report.by_format.length === 0 ? (
                <p className={styles.muted}>No posts in this period.</p>
              ) : (
                <HBarChart
                  selected={selectedFormat}
                  onSelect={(key) => setSelectedFormat((cur) => (cur === key ? null : key))}
                  rows={report.by_format.map((f) => ({
                    key: f.format,
                    label: FORMAT_LABEL[f.format] ?? f.format,
                    sub: `${f.posts} posts · ${pct(f.engagement_rate)}`,
                    value: f.avg_engagements,
                    display: compact(f.avg_engagements),
                  }))}
                />
              )}
            </BentoCard>

            <BentoCard span={6} title="Best time to post" subtitle="Average engagements per post by day and time">
              <TimingHeatmap cells={report.timing} />
            </BentoCard>

            <BentoCard span={7} title="Posts" subtitle={selectedFormat ? `Showing ${FORMAT_LABEL[selectedFormat]} posts` : "Your top 25 posts in this period"}
              action={
                <div className={styles.inlineControls}>
                  <select className={styles.select} value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} aria-label="Platform">
                    <option value="ALL">All platforms</option>
                    <option value="FACEBOOK">Facebook</option>
                    <option value="INSTAGRAM">Instagram</option>
                  </select>
                  <select className={styles.select} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort posts">
                    <option value="engagements">Most engagement</option>
                    <option value="engagement_rate">Highest rate</option>
                    <option value="reach">Most reach</option>
                    <option value="comments">Most comments</option>
                    <option value="created_at">Newest</option>
                  </select>
                </div>
              }
            >
              {posts.length === 0 ? (
                <p className={styles.muted}>No posts match.</p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Post</th>
                        <th>Reach</th>
                        <th>Views</th>
                        <th>Likes</th>
                        <th>Comm.</th>
                        <th>Shares</th>
                        <th>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posts.map((p) => (
                        <tr key={p.id}>
                          <td className={styles.postCell}>
                            <span className={styles.platformTag}>{p.platform === "FACEBOOK" ? "FB" : "IG"} · {FORMAT_LABEL[p.format]}</span>
                            <span className={styles.caption}>{p.caption || "(no caption)"}</span>
                            <small>
                              {new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              {p.permalink && (
                                <a href={p.permalink} target="_blank" rel="noopener noreferrer" className={styles.extLink}>
                                  Open <ExternalLink size={11} />
                                </a>
                              )}
                            </small>
                          </td>
                          <td>{compact(p.reach ?? p.impressions)}</td>
                          <td>{compact(p.views)}</td>
                          <td>{compact(p.likes)}</td>
                          <td>{compact(p.comments)}</td>
                          <td>{compact(p.shares)}</td>
                          <td>{pct(p.engagement_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BentoCard>

            <BentoCard span={5} title="Suggestions" subtitle="From your numbers, plus an AI action plan">
              <SuggestionPanel
                suggestions={report.suggestions}
                coachEndpoint="/api/v1/social/engagement/coach"
                days={days}
                emptyText="Nothing stands out — keep posting consistently."
              />
              <p className={styles.muted}>
                Want to promote a top post? See <Link href="/ads">Ad Manager</Link>.
              </p>
            </BentoCard>
          </BentoGrid>
        </>
      ) : null}

      <CommentTriggers />
    </div>
  );
}
