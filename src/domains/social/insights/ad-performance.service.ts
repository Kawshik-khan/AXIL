/**
 * Ad Manager: Meta ad account performance (spend, clicks, messages, purchases, ad revenue) read live from the Marketing
 * API, joined with what CommerceOS itself saw — conversations that started from an ad and the orders those customers
 * placed afterwards. Meta's numbers are in the ad account's currency; CommerceOS revenue is in the order currency and is
 * never converted. Nothing is estimated; a missing number is null.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import type { Conversation } from "@/types/social";
import { orderRepository } from "@/domains/orders/order.repository";
import {
  resolveMetaReadCredentials,
  graphGet,
  collectPages,
  cached,
  metaCredentialFingerprint,
  num,
  ratio,
  dhakaDate,
  rangeFor,
  sourceError,
  type GraphJson,
} from "./meta-graph-reader";
import type { InsightSuggestion, SourceStatus } from "./suggestion.types";

export interface AdMetrics {
  spend: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  link_clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  messages_started: number;
  leads: number;
  purchases: number;
  /** Purchase value Meta attributes to the ads ("ad revenue"), in the ad account currency. */
  purchase_value: number;
  roas: number | null;
  cost_per_message: number | null;
  cost_per_purchase: number | null;
}

export interface AdCampaignRow extends AdMetrics {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  /** CommerceOS-side results for conversations that named this campaign or one of its ads. */
  commerce: { conversations: number; customers: number; orders: number; revenue: number };
}

export interface CommerceAttribution {
  currency: string;
  ad_conversations: number;
  ad_customers: number;
  converted_customers: number;
  orders: number;
  revenue: number;
  conversion_rate: number | null;
  /** Orders from ad customers in another currency: left out of the totals above, never converted. */
  other_currency_orders: number;
  by_source: Array<{ key: string; label: string; conversations: number; customers: number; orders: number; revenue: number }>;
}

export interface AdsReport {
  range: { since: string; until: string; days: number };
  status: SourceStatus;
  message: string | null;
  account: { id: string; name: string | null; currency: string; status: string | null } | null;
  totals: AdMetrics | null;
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number; messages: number; purchases: number; revenue: number }>;
  campaigns: AdCampaignRow[];
  commerce: CommerceAttribution;
  /** Order revenue CommerceOS attributes to ad conversations ÷ ad spend; only when both are in the same currency. */
  commerce_roas: number | null;
  suggestions: InsightSuggestion[];
  fetched_at: string;
}

// Meta reports overlapping purchase action types; the first one present is used, they are never summed.
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];
const MESSAGE_TYPES = ["onsite_conversion.messaging_conversation_started_7d"];
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

type ActionList = Array<{ action_type?: string; value?: unknown }> | undefined;

function firstAction(list: ActionList, types: string[]): number {
  for (const type of types) {
    const hit = list?.find((a) => a.action_type === type);
    if (hit) return num(hit.value);
  }
  return 0;
}

export function metricsFromInsight(row: GraphJson): AdMetrics {
  const actions = row.actions as ActionList;
  const values = row.action_values as ActionList;
  const spend = num(row.spend);
  const impressions = num(row.impressions);
  const clicks = num(row.clicks);
  const messages = firstAction(actions, MESSAGE_TYPES);
  const purchases = firstAction(actions, PURCHASE_TYPES);
  const purchaseValue = firstAction(values, PURCHASE_TYPES);
  return {
    spend,
    impressions,
    reach: row.reach === undefined ? null : num(row.reach),
    clicks,
    link_clicks: num(row.inline_link_clicks),
    ctr: ratio(clicks, impressions, 100),
    cpc: ratio(spend, clicks),
    cpm: ratio(spend, impressions, 1000),
    frequency: row.frequency === undefined ? null : Math.round(num(row.frequency) * 100) / 100,
    messages_started: messages,
    leads: firstAction(actions, LEAD_TYPES),
    purchases,
    purchase_value: Math.round(purchaseValue * 100) / 100,
    roas: ratio(purchaseValue, spend),
    cost_per_message: ratio(spend, messages),
    cost_per_purchase: ratio(spend, purchases),
  };
}

// ---- CommerceOS attribution -------------------------------------------------------------------------------------------

function adKeyOf(c: Conversation): string | null {
  const ref = c.referral_metadata ?? {};
  const fromRef = typeof ref.ad_id === "string" ? ref.ad_id : typeof ref.campaign_id === "string" ? ref.campaign_id : "";
  return c.source_campaign || c.source_ad || fromRef || null;
}

const NOT_SOLD = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);

/** Orders that were cancelled, returned or refunded are not conversions; only orders in `currency` are summed. */
export async function commerceAttribution(tenantId: string, currency: string, sinceMs: number, untilMs: number): Promise<CommerceAttribution> {
  const conversations = db
    .getAllConversations(tenantId)
    .filter((c) => adKeyOf(c) !== null && new Date(c.created_at).getTime() >= sinceMs && new Date(c.created_at).getTime() <= untilMs);

  // Each customer is credited to the first ad conversation they had in the range
  const firstTouch = new Map<string, { at: number; key: string }>();
  const bySource = new Map<string, { key: string; label: string; conversations: number; customers: Set<string>; orders: number; revenue: number }>();
  for (const c of conversations) {
    const key = adKeyOf(c) as string;
    const label = c.source_campaign || (c.source_ad ? `Ad ${c.source_ad}` : key);
    const group = bySource.get(key) ?? { key, label, conversations: 0, customers: new Set<string>(), orders: 0, revenue: 0 };
    group.conversations++;
    if (c.customer_id) group.customers.add(c.customer_id);
    bySource.set(key, group);
    const at = new Date(c.created_at).getTime();
    const prev = c.customer_id ? firstTouch.get(c.customer_id) : undefined;
    if (c.customer_id && (!prev || at < prev.at)) firstTouch.set(c.customer_id, { at, key });
  }

  let otherCurrency = 0;
  const converted = new Set<string>();
  let orders = 0;
  let revenue = 0;
  if (firstTouch.size > 0) {
    // A bounded window query: in production (Postgres, zero hydration) orders are not held in memory, so getAllOrders
    // would return [] and report false zeros
    for (const o of await orderRepository.findInWindow(tenantId, new Date(sinceMs).toISOString(), new Date(untilMs).toISOString())) {
      const touch = firstTouch.get(o.customer_id);
      if (!touch || NOT_SOLD.has(o.status)) continue;
      const at = new Date(o.created_at).getTime();
      if (at < touch.at || at > untilMs) continue;
      if ((o.currency || currency) !== currency) {
        otherCurrency++;
        continue;
      }
      converted.add(o.customer_id);
      orders++;
      const value = num(o.grand_total);
      revenue += value;
      const group = bySource.get(touch.key);
      if (group) {
        group.orders++;
        group.revenue += value;
      }
    }
  }

  return {
    currency,
    ad_conversations: conversations.length,
    ad_customers: firstTouch.size,
    converted_customers: converted.size,
    orders,
    revenue: Math.round(revenue * 100) / 100,
    conversion_rate: ratio(converted.size, firstTouch.size, 100),
    other_currency_orders: otherCurrency,
    by_source: [...bySource.values()]
      .map((g) => ({ key: g.key, label: g.label, conversations: g.conversations, customers: g.customers.size, orders: g.orders, revenue: Math.round(g.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue || b.conversations - a.conversations),
  };
}

// ---- Suggestions ------------------------------------------------------------------------------------------------------

function money(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function adSuggestions(report: Omit<AdsReport, "suggestions" | "fetched_at">): InsightSuggestion[] {
  const out: InsightSuggestion[] = [];
  const { totals, campaigns, commerce } = report;
  const currency = report.account?.currency ?? "";

  if (report.status !== "LIVE" || !totals) {
    if (commerce.ad_conversations > 0) {
      out.push({
        id: "connect-ads",
        severity: "info",
        title: "Connect your ad account to see cost and ROAS",
        detail: `${commerce.ad_conversations} conversations came from ads, but without the ad account CommerceOS cannot tell what they cost.`,
        action: "Press Connect ads on Ad Manager and pick your ad account.",
        evidence: `${commerce.orders} orders from ad conversations`,
      });
    }
    return out;
  }

  if (totals.spend === 0) {
    out.push({
      id: "no-spend",
      severity: "info",
      title: "No ad spend in this period",
      detail: "The ad account did not spend in the selected range.",
      action: "Start with a Messages campaign on your best organic post and a small daily budget.",
      evidence: `${money(0, currency)} spent`,
    });
    return out;
  }

  const tracksPurchases = totals.purchases > 0 || totals.purchase_value > 0;
  for (const c of campaigns) {
    const share = c.spend / totals.spend;
    const results = c.messages_started + c.purchases + c.leads + c.commerce.orders;
    if (c.spend > 0 && results === 0 && share >= 0.05) {
      out.push({
        id: `no-results-${c.id}`,
        severity: "critical",
        title: `“${c.name}” spent money with no results`,
        detail: `${money(c.spend, currency)} (${Math.round(share * 100)}% of spend) produced no messages, leads or purchases.`,
        action: "Pause it, or change the creative and audience before spending more.",
        evidence: `${c.clicks} clicks, ${c.impressions.toLocaleString("en-US")} impressions`,
        scope: c.id,
      });
      continue;
    }
    if (tracksPurchases && c.roas !== null && c.roas < 1 && share >= 0.1) {
      out.push({
        id: `losing-${c.id}`,
        severity: "critical",
        title: `“${c.name}” is losing money`,
        detail: `ROAS is ${c.roas}: every ${currency} 1 spent returns ${currency} ${c.roas} in purchases.`,
        action: "Cut its budget by half and move it to your best-ROAS campaign, or test a new offer.",
        evidence: `${money(c.spend, currency)} spend → ${money(c.purchase_value, currency)} revenue`,
        scope: c.id,
      });
    }
    if (tracksPurchases && c.roas !== null && totals.roas !== null && c.roas >= 3 && c.roas >= totals.roas * 1.5 && share < 0.5) {
      out.push({
        id: `scale-${c.id}`,
        severity: "opportunity",
        title: `Scale “${c.name}”`,
        detail: `ROAS ${c.roas} against an account average of ${totals.roas}, with only ${Math.round(share * 100)}% of spend.`,
        action: "Raise its budget about 20% every 3 days while ROAS holds; bigger jumps reset learning.",
        evidence: `${c.purchases} purchases, ${money(c.purchase_value, currency)}`,
        scope: c.id,
      });
    }
    if (c.ctr !== null && c.impressions >= 1000 && c.ctr < 0.8) {
      out.push({
        id: `ctr-${c.id}`,
        severity: "warning",
        title: `Weak creative on “${c.name}”`,
        detail: `CTR is ${c.ctr}%. Under about 1% usually means the image or first line does not grab attention.`,
        action: "Test 2–3 new creatives: product in hand, price on screen, a short video, Bangla copy.",
        evidence: `${c.clicks} clicks / ${c.impressions.toLocaleString("en-US")} impressions`,
        scope: c.id,
      });
    }
    if (c.frequency !== null && c.frequency > 3.5) {
      out.push({
        id: `fatigue-${c.id}`,
        severity: "warning",
        title: `Audience fatigue on “${c.name}”`,
        detail: `People see this ad ${c.frequency} times on average; results drop and costs rise past about 3.`,
        action: "Refresh the creative or widen the audience (e.g. a lookalike of past buyers).",
        evidence: `frequency ${c.frequency}`,
        scope: c.id,
      });
    }
    if (c.cost_per_message !== null && totals.cost_per_message !== null && c.messages_started >= 5 && c.cost_per_message >= totals.cost_per_message * 1.5) {
      out.push({
        id: `cpm-msg-${c.id}`,
        severity: "warning",
        title: `Messages from “${c.name}” cost too much`,
        detail: `${money(c.cost_per_message, currency)} per conversation, against ${money(totals.cost_per_message, currency)} for the account.`,
        action: "Move budget to the cheaper message campaigns or tighten its audience.",
        evidence: `${c.messages_started} conversations`,
        scope: c.id,
      });
    }
  }

  if (totals.messages_started > 0 && !tracksPurchases) {
    out.push({
      id: "track-sales",
      severity: "info",
      title: "Meta cannot see your sales",
      detail: "Your ads bring Messenger/WhatsApp conversations, but no purchases are reported back to Meta, so it cannot optimise for buyers.",
      action: "Use the CommerceOS numbers below to judge campaigns, and set up the Conversions API when your store is ready.",
      evidence: `${totals.messages_started} conversations, 0 purchases reported`,
    });
  }

  if (commerce.ad_customers >= 10 && commerce.conversion_rate !== null && commerce.conversion_rate < 10) {
    out.push({
      id: "chat-conversion",
      severity: "warning",
      title: "Ad chats are not turning into orders",
      detail: `Only ${commerce.conversion_rate}% of people who messaged from an ad ordered. The ad works; the follow-up loses them.`,
      action: "Reply within 5 minutes, send price and delivery fee up front, and let the AI agent answer outside business hours.",
      evidence: `${commerce.converted_customers} of ${commerce.ad_customers} customers ordered`,
    });
  }

  if (report.commerce_roas !== null) {
    if (report.commerce_roas < 1) {
      out.push({
        id: "commerce-roas-low",
        severity: "critical",
        title: "Ads cost more than the orders they bring",
        detail: `Orders from ad conversations total ${money(commerce.revenue, commerce.currency)} against ${money(totals.spend, currency)} spend (ROAS ${report.commerce_roas}).`,
        action: "Pause the weakest campaigns and raise average order value with bundles or free delivery over a threshold.",
        evidence: `${commerce.orders} orders`,
      });
    } else if (report.commerce_roas >= 3) {
      out.push({
        id: "commerce-roas-high",
        severity: "opportunity",
        title: "Your ads are profitable — room to grow",
        detail: `Orders from ad conversations returned ${report.commerce_roas}× the ad spend.`,
        action: "Increase total budget gradually (about 20% every few days) and duplicate the best ad set to a new audience.",
        evidence: `${money(commerce.revenue, commerce.currency)} from ${money(totals.spend, currency)}`,
      });
    }
  }

  const order = { critical: 0, warning: 1, opportunity: 2, info: 3 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 12);
}

// ---- Service ----------------------------------------------------------------------------------------------------------

export class AdPerformanceService {
  public static async getReport(context: RequestContext, days: number, opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<AdsReport> {
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const tenantId = context.tenant.id;
    const currency = context.tenant.currency || "BDT";
    return cached(`ads:${tenantId}:${days}:${metaCredentialFingerprint(tenantId)}`, Boolean(opts.refresh), () => this.build(tenantId, currency, days, opts.signal), (r) => r.status === "LIVE");
  }

  private static async build(tenantId: string, currency: string, days: number, signal?: AbortSignal): Promise<AdsReport> {
    const range = rangeFor(days);
    const commerce = await commerceAttribution(tenantId, currency, range.sinceMs, range.untilMs);
    const base = {
      range: { since: range.since, until: range.until, days },
      account: null,
      totals: null,
      daily: [],
      campaigns: [],
      commerce,
      commerce_roas: null,
    };

    const creds = resolveMetaReadCredentials(tenantId);
    if (!creds?.adAccountId || !creds.adsToken) {
      const partial = {
        ...base,
        status: "NOT_CONNECTED" as const,
        message: "Press Connect ads and pick your ad account. Facebook will ask for read access to your ads (ads_read).",
      };
      return { ...partial, suggestions: adSuggestions(partial), fetched_at: new Date().toISOString() };
    }

    const act = `/act_${creds.adAccountId}`;
    const timeRange = JSON.stringify({ since: dhakaDate(range.since), until: dhakaDate(range.until) });
    const metricFields = "spend,impressions,reach,clicks,inline_link_clicks,frequency,actions,action_values";
    try {
      const [account, totalsBody, campaignsBody, dailyBody, statusBody] = await Promise.all([
        graphGet(act, { fields: "name,currency,account_status" }, creds.adsToken, signal),
        graphGet(`${act}/insights`, { level: "account", fields: metricFields, time_range: timeRange }, creds.adsToken, signal),
        graphGet(
          `${act}/insights`,
          { level: "campaign", fields: `campaign_id,campaign_name,objective,${metricFields}`, time_range: timeRange, limit: "100" },
          creds.adsToken,
          signal
        ),
        graphGet(
          `${act}/insights`,
          { level: "account", fields: "spend,impressions,clicks,actions,action_values", time_range: timeRange, time_increment: "1", limit: "100" },
          creds.adsToken,
          signal
        ),
        graphGet(`${act}/campaigns`, { fields: "id,effective_status", limit: "200" }, creds.adsToken, signal).catch(() => null),
      ]);

      const adCurrency = typeof account.currency === "string" ? account.currency : "USD";
      const statusById = new Map<string, string>();
      for (const row of (statusBody?.data as GraphJson[] | undefined) ?? []) statusById.set(String(row.id), String(row.effective_status ?? ""));

      const totalsRow = ((totalsBody.data as GraphJson[] | undefined) ?? [])[0];
      const totals = totalsRow ? metricsFromInsight(totalsRow) : metricsFromInsight({});
      const campaignRows = await collectPages(campaignsBody, creds.adsToken, { maxItems: 200, signal });
      const bySource = new Map(commerce.by_source.map((s) => [s.key, s]));
      const campaigns: AdCampaignRow[] = campaignRows
        .map((row) => {
          const id = String(row.campaign_id ?? "");
          const name = String(row.campaign_name ?? id);
          const own = bySource.get(id) ?? bySource.get(name);
          return {
            id,
            name,
            objective: typeof row.objective === "string" ? row.objective : null,
            status: statusById.get(id) ?? null,
            ...metricsFromInsight(row),
            commerce: own
              ? { conversations: own.conversations, customers: own.customers, orders: own.orders, revenue: own.revenue }
              : { conversations: 0, customers: 0, orders: 0, revenue: 0 },
          };
        })
        .sort((a, b) => b.spend - a.spend);

      const dailyRows = await collectPages(dailyBody, creds.adsToken, { maxItems: 120, signal });
      const daily = dailyRows
        .map((row) => {
          const m = metricsFromInsight(row);
          return {
            date: String(row.date_start ?? ""),
            spend: m.spend,
            impressions: m.impressions,
            clicks: m.clicks,
            messages: m.messages_started,
            purchases: m.purchases,
            revenue: m.purchase_value,
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      const partial = {
        ...base,
        status: "LIVE" as const,
        message: null,
        account: {
          id: `act_${creds.adAccountId}`,
          name: typeof account.name === "string" ? account.name : null,
          currency: adCurrency,
          status: account.account_status === undefined ? null : String(account.account_status) === "1" ? "ACTIVE" : `STATUS_${String(account.account_status)}`,
        },
        totals,
        daily,
        campaigns,
        commerce_roas: adCurrency === commerce.currency && totals.spend > 0 && commerce.orders > 0 ? ratio(commerce.revenue, totals.spend) : null,
      };
      return { ...partial, suggestions: adSuggestions(partial), fetched_at: new Date().toISOString() };
    } catch (err) {
      const partial = { ...base, status: "ERROR" as const, message: sourceError(err) };
      return { ...partial, suggestions: adSuggestions(partial), fetched_at: new Date().toISOString() };
    }
  }
}
