"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { ColumnChart, HBarChart, CompositionBar, TimingHeatmap, compact, pct } from "@/components/insights/Charts";
import { SuggestionPanel } from "@/components/insights/SuggestionPanel";
import { BrandIcon } from "@/components/brand/BrandIcon";
import insights from "@/components/insights/insights.module.css";
import type { EngagementReport, ContentPost } from "@/domains/social/insights/engagement-analysis.service";
import styles from "./Engagement.module.css";

type DailyMetric = "engagements" | "impressions" | "likes" | "comments" | "shares";
const DAILY_LABEL: Record<DailyMetric, string> = {
  engagements: "Engagements",
  impressions: "Impressions",
  likes: "Likes & reactions",
  comments: "Comments",
  shares: "Shares",
};
type SortKey = "created_at" | "engagements" | "engagement_rate" | "reach" | "comments";
export const FORMAT_LABEL: Record<string, string> = { PHOTO: "Photo", VIDEO: "Video", REEL: "Reel", CAROUSEL: "Carousel", TEXT: "Text", LINK: "Link", OTHER: "Other" };

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const brandOf = (platform: string) => (platform === "FACEBOOK" ? "facebook" : "instagram");

/** Performance tab: key figures (pick one to chart it), daily chart, mix, formats, timing, posts and suggestions. */
export function PerformanceView({ report, days }: { report: EngagementReport; days: number }) {
  const [metric, setMetric] = useState<DailyMetric>("engagements");
  const [platform, setPlatform] = useState<"ALL" | "FACEBOOK" | "INSTAGRAM">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("engagements");
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const t = report.totals;

  const posts = useMemo(() => {
    return report.posts
      .filter((p: ContentPost) => platform === "ALL" || p.platform === platform)
      .filter((p) => !selectedFormat || p.format === selectedFormat)
      .sort((a, b) => {
        if (sortKey === "created_at") return b.created_at.localeCompare(a.created_at);
        return ((b[sortKey] as number | null) ?? -1) - ((a[sortKey] as number | null) ?? -1);
      })
      .slice(0, 25);
  }, [report, platform, sortKey, selectedFormat]);

  const tiles: Array<{ key: DailyMetric; label: string; value: string; note: string; lead?: boolean }> = [
    { key: "engagements", label: "Engagement rate", value: pct(t.engagement_rate), note: `${compact(t.engagements)} engagements`, lead: true },
    { key: "impressions", label: "Impressions", value: compact(t.impressions), note: t.impressions === null ? "Not reported by Meta" : `${t.posts} posts` },
    { key: "likes", label: "Likes", value: compact(t.likes), note: "Likes & reactions" },
    { key: "comments", label: "Comments", value: compact(t.comments), note: "Each one is a chance to chat" },
    { key: "shares", label: "Shares", value: compact(t.shares), note: "Facebook and Instagram" },
  ];
  const withTotals = report.sources.filter((s) => s.totals);

  return (
    <>
      <section className={styles.kpis} aria-label="Key figures: pick one to chart it by day">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className={`${styles.kpi} ${tile.lead ? styles.kpiLead : ""}`}
            aria-pressed={metric === tile.key}
            onClick={() => setMetric(tile.key)}
          >
            <span className={styles.kpiLabel}>{tile.label}</span>
            <span>
              <span className={styles.kpiValue}>{tile.value}</span>
              <span className={styles.kpiNote}>{tile.note}</span>
            </span>
          </button>
        ))}
      </section>
      <div className={styles.minor}>
        <span>
          Reach <strong>{compact(t.reach)}</strong>
        </span>
        <span>
          Views <strong>{compact(t.views)}</strong>
        </span>
        <span>
          Saves <strong>{compact(t.saves)}</strong> {t.saves === null && <span className={styles.muted}>Instagram only</span>}
        </span>
        <span>
          Posts <strong>{t.posts}</strong>
        </span>
      </div>

      <BentoGrid>
        <BentoCard span={8} title={`${DAILY_LABEL[metric]} by day`} subtitle="By publish date, Dhaka time. Pick a figure above to switch.">
          <ColumnChart
            ariaLabel={`${DAILY_LABEL[metric]} per day`}
            format={(v) => compact(Math.round(v))}
            points={report.daily.map((d) => ({
              label: shortDate(d.date),
              value: d[metric],
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
          {withTotals.length > 1 && (
            <table className={insights.miniTable}>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Posts</th>
                  <th>Eng.</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {withTotals.map((s) => (
                  <tr key={s.platform}>
                    <td>
                      <span className={insights.platformName}>
                        <BrandIcon brand={brandOf(s.platform)} size={16} />
                        {s.platform === "FACEBOOK" ? "Facebook" : "Instagram"}
                      </span>
                    </td>
                    <td>{s.totals?.posts}</td>
                    <td>{compact(s.totals?.engagements)}</td>
                    <td>{pct(s.totals?.engagement_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BentoCard>

        <BentoCard span={6} title="Which formats work" subtitle="Average engagements per post. Pick one to filter the posts below.">
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

        <BentoCard span={6} title="Best time to post" subtitle="Average engagements per post, by day and time (Dhaka)">
          <TimingHeatmap cells={report.timing} />
        </BentoCard>

        <BentoCard
          span={8}
          title="Posts"
          subtitle={selectedFormat ? `Showing ${FORMAT_LABEL[selectedFormat] ?? selectedFormat} posts · pick the format again to clear` : "Your top 25 posts in this period"}
          action={
            <div className={insights.inlineControls}>
              <select className={insights.select} value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} aria-label="Platform">
                <option value="ALL">All platforms</option>
                <option value="FACEBOOK">Facebook</option>
                <option value="INSTAGRAM">Instagram</option>
              </select>
              <select className={insights.select} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort posts">
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
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Post</th>
                    <th className={styles.num}>Reach</th>
                    <th className={styles.num}>Likes</th>
                    <th className={styles.num}>Comm.</th>
                    <th className={styles.num}>Shares</th>
                    <th className={styles.num}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className={styles.postCell}>
                          <span className={styles.postMeta}>
                            <BrandIcon brand={brandOf(p.platform)} size={14} />
                            {FORMAT_LABEL[p.format] ?? p.format} · {new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            {p.permalink && (
                              <a href={p.permalink} target="_blank" rel="noopener noreferrer" className={styles.extLink}>
                                Open <ExternalLink size={11} />
                              </a>
                            )}
                          </span>
                          <span className={styles.caption}>{p.caption || "(no caption)"}</span>
                        </div>
                      </td>
                      <td className={styles.num}>{compact(p.reach ?? p.impressions)}</td>
                      <td className={styles.num}>{compact(p.likes)}</td>
                      <td className={styles.num}>{compact(p.comments)}</td>
                      <td className={styles.num}>{compact(p.shares)}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{pct(p.engagement_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BentoCard>

        <aside className={`${styles.lilac} ${styles.span4}`} aria-label="Suggestions">
          <div>
            <h2 className={styles.lilacTitle}>Suggestions</h2>
            <div className={styles.lilacNote}>From your numbers, plus an AI action plan. Nothing is posted for you.</div>
          </div>
          <SuggestionPanel suggestions={report.suggestions} coachEndpoint="/api/v1/social/engagement/coach" days={days} emptyText="Nothing stands out — keep posting consistently." />
          <Link href="/ads" className={styles.lilacLink}>
            Promote a top post in Ad Manager →
          </Link>
        </aside>
      </BentoGrid>
    </>
  );
}
