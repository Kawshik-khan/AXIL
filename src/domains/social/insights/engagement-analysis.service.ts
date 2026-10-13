/**
 * Engagement Analysis: what the tenant's Facebook Page and Instagram posts earned (impressions, views, reach, likes,
 * comments, shares, saves), read live from the Meta Graph API. Nothing is estimated: a metric Meta does not return is
 * null and the UI shows it as unavailable. Suggestions are rules over these numbers, each with its evidence.
 */

import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import {
  resolveMetaReadCredentials,
  graphGet,
  graphGetWithFallback,
  collectPages,
  cached,
  metaCredentialFingerprint,
  num,
  ratio,
  dhakaDate,
  rangeFor,
  sourceError,
  DHAKA_OFFSET_MS,
  type GraphJson,
  type MetaReadCredentials,
} from "./meta-graph-reader";
import type { InsightSuggestion, SourceStatus } from "./suggestion.types";

export type ContentPlatform = "FACEBOOK" | "INSTAGRAM";
export type ContentFormat = "PHOTO" | "VIDEO" | "REEL" | "CAROUSEL" | "TEXT" | "LINK" | "OTHER";

export interface ContentPost {
  id: string;
  platform: ContentPlatform;
  format: ContentFormat;
  caption: string;
  permalink: string | null;
  thumbnail_url: string | null;
  created_at: string;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  engagements: number;
  engagement_rate: number | null;
}

export interface EngagementTotals {
  posts: number;
  impressions: number | null;
  reach: number | null;
  views: number | null;
  likes: number;
  comments: number;
  shares: number | null;
  saves: number | null;
  engagements: number;
  engagement_rate: number | null;
}

export interface EngagementSource {
  platform: ContentPlatform;
  status: SourceStatus;
  account_name: string | null;
  followers: number | null;
  message: string | null;
  totals: EngagementTotals | null;
}

export interface EngagementReport {
  range: { since: string; until: string; days: number };
  sources: EngagementSource[];
  totals: EngagementTotals;
  daily: Array<{ date: string; posts: number; impressions: number | null; engagements: number; likes: number; comments: number; shares: number }>;
  by_format: Array<{ format: ContentFormat; posts: number; engagements: number; avg_engagements: number; engagement_rate: number | null }>;
  /** Average engagements per post by Dhaka weekday (0 = Sunday) and 3-hour block (0 = 00:00-02:59). */
  timing: Array<{ weekday: number; block: number; posts: number; avg_engagements: number }>;
  posts: ContentPost[];
  /** A platform hit the post cap, so totals cover only its most recent posts. */
  truncated: boolean;
  suggestions: InsightSuggestion[];
  fetched_at: string;
}

const MAX_POSTS_PER_PLATFORM = 100;

// ---- Facebook ---------------------------------------------------------------------------------------------------------

const FB_BASE_FIELDS =
  "id,message,created_time,permalink_url,full_picture,status_type,attachments{media_type,type},shares," +
  "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
const FB_FIELD_SETS = [
  `${FB_BASE_FIELDS},insights.metric(post_impressions,post_impressions_unique,post_video_views)`,
  `${FB_BASE_FIELDS},insights.metric(post_media_view,post_total_media_view_unique)`,
  FB_BASE_FIELDS,
];

function insightValues(row: GraphJson): Record<string, number> {
  const out: Record<string, number> = {};
  const data = (row.insights as { data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> } | undefined)?.data;
  for (const metric of data ?? []) {
    if (!metric.name) continue;
    const value = metric.values?.[0]?.value ?? metric.total_value?.value;
    if (typeof value === "number" || typeof value === "string") out[metric.name] = num(value);
  }
  return out;
}

function pick(values: Record<string, number>, names: string[]): number | null {
  for (const name of names) if (name in values) return values[name];
  return null;
}

function facebookFormat(row: GraphJson): ContentFormat {
  const attachment = (row.attachments as { data?: Array<{ media_type?: string; type?: string }> } | undefined)?.data?.[0];
  const media = `${attachment?.media_type ?? ""} ${attachment?.type ?? ""} ${String(row.status_type ?? "")}`.toLowerCase();
  if (media.includes("reel")) return "REEL";
  if (media.includes("video")) return "VIDEO";
  if (media.includes("album")) return "CAROUSEL";
  if (media.includes("photo")) return "PHOTO";
  if (media.includes("link") || media.includes("share")) return "LINK";
  if (!attachment) return "TEXT";
  return "OTHER";
}

/** Meta hosts only: the page renders these as links and images, so anything else (javascript:, other sites) becomes null. */
const META_HOSTS = ["facebook.com", "fb.com", "instagram.com", "fbcdn.net", "cdninstagram.com"];

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && META_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? value : null;
  } catch {
    return null;
  }
}

function toPost(base: Omit<ContentPost, "engagements" | "engagement_rate">): ContentPost {
  const engagements = base.likes + base.comments + (base.shares ?? 0) + (base.saves ?? 0);
  const denominator = base.reach ?? base.impressions;
  return { ...base, engagements, engagement_rate: denominator ? ratio(engagements, denominator, 100) : null };
}

async function fetchFacebook(creds: MetaReadCredentials, sinceMs: number, untilMs: number, signal?: AbortSignal) {
  const page = await graphGet(`/${encodeURIComponent(creds.pageId)}`, { fields: "name,followers_count,fan_count" }, creds.pageToken, signal);
  const { body } = await graphGetWithFallback(
    `/${encodeURIComponent(creds.pageId)}/published_posts`,
    { since: String(Math.floor(sinceMs / 1000)), until: String(Math.floor(untilMs / 1000)), limit: "50" },
    FB_FIELD_SETS,
    creds.pageToken,
    signal
  );
  const rows = await collectPages(body, creds.pageToken, {
    maxItems: MAX_POSTS_PER_PLATFORM,
    stop: (row) => new Date(String(row.created_time)).getTime() < sinceMs,
    signal,
  });
  const posts = rows.map((row) => {
    const values = insightValues(row);
    return toPost({
      id: String(row.id),
      platform: "FACEBOOK",
      format: facebookFormat(row),
      caption: String(row.message ?? "").slice(0, 160),
      permalink: httpsUrl(row.permalink_url),
      thumbnail_url: httpsUrl(row.full_picture),
      created_at: new Date(String(row.created_time)).toISOString(),
      impressions: pick(values, ["post_impressions"]),
      reach: pick(values, ["post_impressions_unique", "post_total_media_view_unique"]),
      views: pick(values, ["post_media_view", "post_video_views"]),
      likes: num((row.reactions as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count),
      comments: num((row.comments as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count),
      shares: num((row.shares as { count?: unknown } | undefined)?.count),
      saves: null,
    });
  });
  const followers = page.followers_count ?? page.fan_count;
  return { name: typeof page.name === "string" ? page.name : null, followers: followers === undefined ? null : num(followers), posts };
}

// ---- Instagram --------------------------------------------------------------------------------------------------------

const IG_BASE_FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count";
const IG_FIELD_SETS = [
  `${IG_BASE_FIELDS},insights.metric(views,reach,saved,shares)`,
  `${IG_BASE_FIELDS},insights.metric(impressions,reach,saved,shares)`,
  `${IG_BASE_FIELDS},insights.metric(reach,saved)`,
  IG_BASE_FIELDS,
];

function instagramFormat(row: GraphJson): ContentFormat {
  if (row.media_product_type === "REELS") return "REEL";
  if (row.media_type === "VIDEO") return "VIDEO";
  if (row.media_type === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (row.media_type === "IMAGE") return "PHOTO";
  return "OTHER";
}

async function resolveInstagramId(creds: MetaReadCredentials, signal?: AbortSignal): Promise<string> {
  if (creds.instagramUserId) return creds.instagramUserId;
  if (!creds.pageId) return "";
  const page = await graphGet(`/${encodeURIComponent(creds.pageId)}`, { fields: "instagram_business_account" }, creds.pageToken, signal);
  const account = page.instagram_business_account as { id?: unknown } | undefined;
  return typeof account?.id === "string" ? account.id : "";
}

async function fetchInstagram(creds: MetaReadCredentials, igId: string, sinceMs: number, signal?: AbortSignal) {
  const profile = await graphGet(`/${encodeURIComponent(igId)}`, { fields: "username,followers_count" }, creds.pageToken, signal);
  const { body } = await graphGetWithFallback(`/${encodeURIComponent(igId)}/media`, { limit: "50" }, IG_FIELD_SETS, creds.pageToken, signal);
  const rows = await collectPages(body, creds.pageToken, {
    maxItems: MAX_POSTS_PER_PLATFORM,
    stop: (row) => new Date(String(row.timestamp)).getTime() < sinceMs,
    signal,
  });
  const posts = rows.map((row) => {
    const values = insightValues(row);
    return toPost({
      id: String(row.id),
      platform: "INSTAGRAM",
      format: instagramFormat(row),
      caption: String(row.caption ?? "").slice(0, 160),
      permalink: httpsUrl(row.permalink),
      thumbnail_url: httpsUrl(row.thumbnail_url) ?? (row.media_type !== "VIDEO" ? httpsUrl(row.media_url) : null),
      created_at: new Date(String(row.timestamp)).toISOString(),
      impressions: pick(values, ["impressions"]),
      reach: pick(values, ["reach"]),
      views: pick(values, ["views", "plays", "video_views"]),
      likes: num(row.like_count),
      comments: num(row.comments_count),
      shares: pick(values, ["shares"]),
      saves: pick(values, ["saved"]),
    });
  });
  return {
    name: typeof profile.username === "string" ? `@${profile.username}` : null,
    followers: profile.followers_count === undefined ? null : num(profile.followers_count),
    posts,
  };
}

// ---- Aggregation ------------------------------------------------------------------------------------------------------

function sumNullable(posts: ContentPost[], key: "impressions" | "reach" | "views" | "shares" | "saves"): number | null {
  let seen = false;
  let total = 0;
  for (const p of posts) {
    const v = p[key];
    if (v !== null) {
      seen = true;
      total += v;
    }
  }
  return seen ? total : null;
}

export function totalsOf(posts: ContentPost[]): EngagementTotals {
  const engagements = posts.reduce((s, p) => s + p.engagements, 0);
  const reach = sumNullable(posts, "reach");
  const impressions = sumNullable(posts, "impressions");
  // Rate over the posts that report a denominator, so a post without insights does not inflate it
  const measured = posts.filter((p) => (p.reach ?? p.impressions) !== null);
  const measuredEngagements = measured.reduce((s, p) => s + p.engagements, 0);
  const measuredBase = measured.reduce((s, p) => s + (p.reach ?? p.impressions ?? 0), 0);
  return {
    posts: posts.length,
    impressions,
    reach,
    views: sumNullable(posts, "views"),
    likes: posts.reduce((s, p) => s + p.likes, 0),
    comments: posts.reduce((s, p) => s + p.comments, 0),
    shares: sumNullable(posts, "shares"),
    saves: sumNullable(posts, "saves"),
    engagements,
    engagement_rate: measured.length ? ratio(measuredEngagements, measuredBase, 100) : null,
  };
}

function dailySeries(posts: ContentPost[], sinceMs: number, days: number): EngagementReport["daily"] {
  const byDate = new Map<string, EngagementReport["daily"][number]>();
  for (let i = 0; i <= days; i++) {
    const date = dhakaDate(new Date(sinceMs + i * 86_400_000).toISOString());
    if (!byDate.has(date)) byDate.set(date, { date, posts: 0, impressions: null, engagements: 0, likes: 0, comments: 0, shares: 0 });
  }
  for (const p of posts) {
    const row = byDate.get(dhakaDate(p.created_at));
    if (!row) continue;
    row.posts++;
    row.engagements += p.engagements;
    row.likes += p.likes;
    row.comments += p.comments;
    row.shares += p.shares ?? 0;
    if (p.impressions !== null || p.views !== null) row.impressions = (row.impressions ?? 0) + (p.impressions ?? p.views ?? 0);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function formatBreakdown(posts: ContentPost[]): EngagementReport["by_format"] {
  const groups = new Map<ContentFormat, ContentPost[]>();
  for (const p of posts) groups.set(p.format, [...(groups.get(p.format) ?? []), p]);
  return [...groups.entries()]
    .map(([format, list]) => {
      const t = totalsOf(list);
      return { format, posts: list.length, engagements: t.engagements, avg_engagements: Math.round(t.engagements / list.length), engagement_rate: t.engagement_rate };
    })
    .sort((a, b) => b.avg_engagements - a.avg_engagements);
}

function timingGrid(posts: ContentPost[]): EngagementReport["timing"] {
  const cells = new Map<string, { weekday: number; block: number; posts: number; total: number }>();
  for (const p of posts) {
    const local = new Date(new Date(p.created_at).getTime() + DHAKA_OFFSET_MS);
    const weekday = local.getUTCDay();
    const block = Math.floor(local.getUTCHours() / 3);
    const key = `${weekday}:${block}`;
    const cell = cells.get(key) ?? { weekday, block, posts: 0, total: 0 };
    cell.posts++;
    cell.total += p.engagements;
    cells.set(key, cell);
  }
  return [...cells.values()].map((c) => ({ weekday: c.weekday, block: c.block, posts: c.posts, avg_engagements: Math.round(c.total / c.posts) }));
}

// ---- Suggestions ------------------------------------------------------------------------------------------------------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FORMAT_LABEL: Record<ContentFormat, string> = {
  PHOTO: "Photo",
  VIDEO: "Video",
  REEL: "Reel",
  CAROUSEL: "Carousel",
  TEXT: "Text",
  LINK: "Link",
  OTHER: "Other",
};

function blockLabel(block: number): string {
  const start = block * 3;
  const fmt = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  return `${fmt(start)}–${fmt((start + 3) % 24)}`;
}

export function engagementSuggestions(report: Omit<EngagementReport, "suggestions" | "fetched_at">): InsightSuggestion[] {
  const out: InsightSuggestion[] = [];
  const { totals, posts, range } = report;
  const live = report.sources.filter((s) => s.status === "LIVE");

  if (live.length === 0) return out;
  if (totals.posts === 0) {
    out.push({
      id: "no-posts",
      severity: "warning",
      title: "No posts in this period",
      detail: `Nothing was published in the last ${range.days} days, so the algorithm has nothing to show your followers.`,
      action: "Plan 3–5 posts a week: product photos, a short Reel, and one offer post.",
      evidence: `0 posts in ${range.days} days`,
    });
    return out;
  }

  const perWeek = (totals.posts / range.days) * 7;
  if (perWeek < 3) {
    out.push({
      id: "cadence",
      severity: "warning",
      title: "Posting too rarely to stay in feeds",
      detail: `You are posting about ${perWeek.toFixed(1)} times a week. Pages that post 3–5 times a week keep a steadier reach.`,
      action: "Batch-create a week of posts and schedule them in Meta Business Suite.",
      evidence: `${totals.posts} posts in ${range.days} days`,
    });
  }

  const avgEngagements = totals.engagements / totals.posts;
  const formats = report.by_format.filter((f) => f.posts >= 2);
  if (formats.length >= 2) {
    const best = formats[0];
    const worst = formats[formats.length - 1];
    if (best.avg_engagements >= avgEngagements * 1.3 && best.avg_engagements > 0) {
      out.push({
        id: "best-format",
        severity: "opportunity",
        title: `${FORMAT_LABEL[best.format]} posts work best for you`,
        detail: `${FORMAT_LABEL[best.format]} posts average ${best.avg_engagements} engagements, against ${Math.round(avgEngagements)} across all posts and ${worst.avg_engagements} for ${FORMAT_LABEL[worst.format].toLowerCase()} posts.`,
        action: `Shift more of next week's plan to ${FORMAT_LABEL[best.format].toLowerCase()} posts.`,
        evidence: `${best.posts} ${FORMAT_LABEL[best.format].toLowerCase()} posts, ${best.engagements} engagements`,
      });
    }
  }

  const cells = report.timing.filter((c) => c.posts >= 2).sort((a, b) => b.avg_engagements - a.avg_engagements);
  if (cells.length >= 2 && cells[0].avg_engagements >= avgEngagements * 1.3) {
    const best = cells[0];
    out.push({
      id: "best-time",
      severity: "opportunity",
      title: `Best time to post: ${WEEKDAYS[best.weekday]} ${blockLabel(best.block)}`,
      detail: `Posts published ${WEEKDAYS[best.weekday]} ${blockLabel(best.block)} (Dhaka time) average ${best.avg_engagements} engagements, ${(best.avg_engagements / Math.max(avgEngagements, 1)).toFixed(1)}× your average.`,
      action: "Schedule your strongest product and offer posts in this window.",
      evidence: `${best.posts} posts in that window`,
    });
  }

  if (totals.engagement_rate !== null && totals.engagement_rate < 1) {
    out.push({
      id: "low-rate",
      severity: "warning",
      title: "People see your posts but rarely react",
      detail: `Engagement rate is ${totals.engagement_rate}% of reach. Under 1% usually means the first line or image does not stop the scroll.`,
      action: "Open with the price or offer, show the product in use, and end with a question (e.g. “Which colour do you want?”).",
      evidence: `${totals.engagements} engagements on ${totals.reach ?? totals.impressions} reach`,
    });
  }

  if (totals.engagements >= 20 && totals.comments / totals.engagements >= 0.3) {
    out.push({
      id: "comment-demand",
      severity: "opportunity",
      title: "Comments are buying signals — answer them fast",
      detail: `${Math.round((totals.comments / totals.engagements) * 100)}% of your engagement is comments, which in Bangladesh is often “price?” or “details?”.`,
      action: "Reply within an hour and move the buyer to Messenger or WhatsApp; turn on comment auto-replies in Conversations.",
      evidence: `${totals.comments} comments`,
    });
  }

  const top = [...posts].sort((a, b) => b.engagements - a.engagements)[0];
  if (top && posts.length >= 3 && top.engagements >= avgEngagements * 2 && top.engagements >= 10) {
    out.push({
      id: "boost-top",
      severity: "opportunity",
      title: "Boost your best organic post",
      detail: `Your top ${top.platform === "FACEBOOK" ? "Facebook" : "Instagram"} post earned ${top.engagements} engagements, ${(top.engagements / Math.max(avgEngagements, 1)).toFixed(1)}× your average. Proven organic content usually makes a cheaper ad.`,
      action: "Promote it as a Messages ad in Ad Manager with a small test budget.",
      evidence: top.caption ? `“${top.caption.slice(0, 60)}${top.caption.length > 60 ? "…" : ""}”` : `post ${top.id}`,
      scope: top.id,
    });
  }

  if (totals.shares !== null && totals.posts >= 5 && totals.engagements > 0 && totals.shares / totals.engagements < 0.03) {
    out.push({
      id: "low-shares",
      severity: "info",
      title: "Few people share your posts",
      detail: "Shares bring new customers for free, but under 3% of your engagement is shares.",
      action: "Try share-worthy posts: giveaways (“tag a friend”), useful tips, or limited-time Eid/Pohela Boishakh offers.",
      evidence: `${totals.shares} shares`,
    });
  }

  const ig = report.sources.find((s) => s.platform === "INSTAGRAM");
  if (ig?.status === "NOT_CONNECTED" && live.some((s) => s.platform === "FACEBOOK")) {
    out.push({
      id: "connect-instagram",
      severity: "info",
      title: "Instagram is not included",
      detail: "Only Facebook posts are analysed. Link an Instagram Professional account to your Page to compare both.",
      action: "Connect Instagram to the Page, or add its account ID to the Meta Graph connector.",
      evidence: "Instagram: not connected",
    });
  }

  return out;
}

// ---- Service ----------------------------------------------------------------------------------------------------------

export class EngagementAnalysisService {
  public static async getReport(context: RequestContext, days: number, opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<EngagementReport> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_ANALYTICS_READ);
    const tenantId = context.tenant.id;
    return cached(
      `engagement:${tenantId}:${days}:${metaCredentialFingerprint(tenantId)}`,
      Boolean(opts.refresh),
      () => this.build(tenantId, days, opts.signal),
      (r) => r.sources.some((s) => s.status === "LIVE") && !r.sources.some((s) => s.status === "ERROR")
    );
  }

  private static async build(tenantId: string, days: number, signal?: AbortSignal): Promise<EngagementReport> {
    const range = rangeFor(days);
    const creds = resolveMetaReadCredentials(tenantId);
    const sources: EngagementSource[] = [];
    const posts: ContentPost[] = [];

    if (!creds || !creds.pageToken) {
      const message = "Connect the Meta Graph connector (or a Facebook channel) to see your content performance.";
      sources.push({ platform: "FACEBOOK", status: "NOT_CONNECTED", account_name: null, followers: null, message, totals: null });
      sources.push({ platform: "INSTAGRAM", status: "NOT_CONNECTED", account_name: null, followers: null, message, totals: null });
    } else {
      const [fb, ig] = await Promise.all([
        creds.pageId
          ? fetchFacebook(creds, range.sinceMs, range.untilMs, signal).then(
              (r) => ({ ok: true as const, r }),
              (err: unknown) => ({ ok: false as const, err })
            )
          : Promise.resolve(null),
        resolveInstagramId(creds, signal)
          .then((igId) => (igId ? fetchInstagram(creds, igId, range.sinceMs, signal) : null))
          .then(
            (r) => (r ? { ok: true as const, r } : null),
            (err: unknown) => ({ ok: false as const, err })
          ),
      ]);
      for (const [platform, result] of [["FACEBOOK", fb], ["INSTAGRAM", ig]] as const) {
        if (!result) {
          sources.push({
            platform,
            status: "NOT_CONNECTED",
            account_name: null,
            followers: null,
            message: platform === "FACEBOOK" ? "No Facebook Page ID is configured." : "No Instagram Professional account is linked to this Page.",
            totals: null,
          });
        } else if (result.ok) {
          posts.push(...result.r.posts);
          sources.push({ platform, status: "LIVE", account_name: result.r.name, followers: result.r.followers, message: null, totals: totalsOf(result.r.posts) });
        } else {
          sources.push({ platform, status: "ERROR", account_name: null, followers: null, message: sourceError(result.err), totals: null });
        }
      }
    }

    posts.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const partial = {
      range: { since: range.since, until: range.until, days },
      truncated: (["FACEBOOK", "INSTAGRAM"] as const).some((pl) => posts.filter((p) => p.platform === pl).length >= MAX_POSTS_PER_PLATFORM),
      sources,
      totals: totalsOf(posts),
      daily: dailySeries(posts, range.sinceMs, days),
      by_format: formatBreakdown(posts),
      timing: timingGrid(posts),
      posts,
    };
    return { ...partial, suggestions: engagementSuggestions(partial), fetched_at: new Date().toISOString() };
  }
}
