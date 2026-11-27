"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, MessageSquareReply } from "lucide-react";
import { EmptyState, ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { BrandIcon } from "@/components/brand/BrandIcon";
import { compact } from "@/components/insights/Charts";
import type { ContentPost } from "@/domains/social/insights/engagement-analysis.service";
import type { PostSalesReport } from "@/domains/social/insights/post-sales.service";
import { FORMAT_LABEL } from "./PerformanceView";
import styles from "./Engagement.module.css";

type LoadError = { message: string; requestId?: string; status?: number };

const taka = (n: number) => `৳${Math.round(n).toLocaleString("en-IN")}`;
const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** The post Meta knows (caption, format, link), matched by full id or by the part after the page id. */
function postIndex(posts: ContentPost[]): Map<string, ContentPost> {
  const map = new Map<string, ContentPost>();
  for (const p of posts) {
    map.set(p.id, p);
    if (p.id.includes("_")) map.set(p.id.slice(p.id.indexOf("_") + 1), p);
  }
  return map;
}

interface PostSalesViewProps {
  days: number;
  /** Posts from the performance report, for captions; empty when Meta is not connected */
  posts: ContentPost[];
  onOpenTriggers: () => void;
}

/** Posts that sold: Comment-to-DM messages per post → replies → orders and revenue (GET /api/v1/social/engagement/sales). */
export function PostSalesView({ days, posts, onOpenTriggers }: PostSalesViewProps) {
  const [report, setReport] = useState<PostSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/social/engagement/sales?days=${days}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: json?.error?.message || "Sales from posts could not be loaded.", requestId: json?.error?.request_id, status: res.status });
        return;
      }
      setReport(json.data as PostSalesReport);
    } catch {
      setError({ message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const known = useMemo(() => postIndex(posts), [posts]);

  if (error?.status === 403) return <PermissionDenied resource="sales from posts" requiredPermission="social.analytics.read and orders.read" />;
  if (loading && !report) return <LoadingSkeleton lines={8} />;
  if (error || !report) return <ErrorState message={error?.message ?? "Sales from posts could not be loaded."} requestId={error?.requestId} onRetry={load} />;

  const t = report.totals;
  if (t.matched_comments === 0) {
    return (
      <EmptyState
        icon={<MessageSquareReply size={28} />}
        title="No comments matched a trigger in this period"
        description="Posts that sold follows comments that a Comment-to-DM trigger answered in the inbox. Set up a trigger, then sales from your posts show here."
        actionText="Open Comment to DM"
        onAction={onOpenTriggers}
      />
    );
  }

  const steps = [
    { label: "Matched comments", value: t.matched_comments, note: "Comments a trigger answered", of: t.matched_comments },
    { label: "Messages sent", value: t.messages_sent, note: `${share(t.messages_sent, t.matched_comments)} of matched comments`, of: t.messages_sent },
    { label: "Replied in inbox", value: t.replied, note: `${share(t.replied, t.messages_sent)} of messages sent`, of: t.replied },
    { label: "Customers who ordered", value: t.customers, note: `${share(t.customers, t.replied)} of those who replied`, of: t.customers },
  ];

  return (
    <>
      <section className={styles.kpis} aria-label="From comment to order">
        <div className={`${styles.kpi} ${styles.kpiLead}`}>
          <span className={styles.kpiLabel}>Revenue from your posts</span>
          <span>
            <span className={styles.kpiValue}>{report.currency === "BDT" ? taka(t.revenue) : `${t.revenue.toLocaleString()} ${report.currency}`}</span>
            <span className={styles.kpiNote}>
              {t.orders} {t.orders === 1 ? "order" : "orders"} from {t.customers} {t.customers === 1 ? "customer" : "customers"}
            </span>
          </span>
        </div>
        {steps.map((s) => (
          <div key={s.label} className={styles.kpi}>
            <span className={styles.kpiLabel}>{s.label}</span>
            <span>
              <span className={styles.kpiValue}>{s.value.toLocaleString()}</span>
              <span className={styles.kpiNote}>{s.note}</span>
              <span className={styles.kpiTrack} aria-hidden="true">
                <span className={styles.kpiFill} style={{ width: `${Math.max(2, (s.of / t.matched_comments) * 100)}%` }} />
              </span>
            </span>
          </div>
        ))}
      </section>

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.span8}`} aria-label="Posts by sales">
          <div>
            <h2 className={styles.cardTitle}>Posts by sales</h2>
            <div className={styles.muted}>Each post’s path from comment to paid order, most revenue first</div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Post</th>
                  <th className={styles.num}>Matched</th>
                  <th className={styles.num}>Sent</th>
                  <th className={styles.num}>Replied</th>
                  <th className={styles.num}>Customers</th>
                  <th className={styles.num}>Orders</th>
                  <th className={styles.num}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.posts.map((row, i) => {
                  const post = known.get(row.post_id) ?? known.get(row.post_id.slice(row.post_id.indexOf("_") + 1));
                  const brand = row.channel_type === "FACEBOOK_MESSENGER" ? "facebook" : "instagram";
                  return (
                    <tr key={row.post_id}>
                      <td>
                        <div className={styles.postCell}>
                          <span className={styles.postMeta}>
                            <BrandIcon brand={brand} size={14} />
                            {post ? `${FORMAT_LABEL[post.format] ?? post.format} · ${new Date(post.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : `Post ${row.post_id}`}
                            {i === 0 && row.revenue > 0 && <span className={styles.topSeller}>Top seller</span>}
                            {post?.permalink && (
                              <a href={post.permalink} target="_blank" rel="noopener noreferrer" className={styles.extLink}>
                                Open <ExternalLink size={11} />
                              </a>
                            )}
                          </span>
                          <span className={styles.caption}>{post ? post.caption || "(no caption)" : posts.length === 0 ? "Connect Facebook or Instagram to see the post" : "Not in this period’s posts from Meta"}</span>
                        </div>
                      </td>
                      <td className={styles.num}>{compact(row.matched_comments)}</td>
                      <td className={styles.num}>{compact(row.messages_sent)}</td>
                      <td className={styles.num}>{compact(row.replied)}</td>
                      <td className={styles.num}>{row.customers}</td>
                      <td className={styles.num}>{row.orders}</td>
                      <td className={`${styles.num} ${styles.strong}`}>{report.currency === "BDT" ? taka(row.revenue) : row.revenue.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className={`${styles.lilac} ${styles.span4}`} aria-label="How it's counted">
          <div>
            <h2 className={styles.lilacTitle}>How it’s counted</h2>
            <div className={styles.lilacNote}>Only comments a Comment-to-DM trigger answered can be followed to a sale.</div>
          </div>
          <div className={styles.lilacBox}>
            <strong>From comment to order</strong>
            <span>A comment matched a trigger and the customer got your message in their inbox.</span>
            <span>They wrote to you in the inbox after it (any message counts), and placed an order within {report.window_days} days of your message.</span>
            <span>A customer counts once, for the first post that reached them in this period.</span>
          </div>
          <div className={styles.lilacBox}>
            <strong>Left out</strong>
            <span>Cancelled, returned and refunded orders.</span>
            <span>Comments no trigger answered, and messages nobody replied to.</span>
            {report.other_currency_orders > 0 && <span>{report.other_currency_orders} orders in another currency (not added up).</span>}
          </div>
        </aside>
      </div>
    </>
  );
}
