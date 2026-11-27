/**
 * Posts that sold: which Facebook / Instagram posts led to paid orders, through Comment-to-DM.
 *
 * A comment that matched a trigger got an inbox message (a SENT event, which records the post and the commenter's inbox
 * id). When the commenter then wrote back, the inbox has a conversation for that inbox id on the same channel. Each such
 * customer is credited to the first post that reached them in the range, and their orders placed from that message up to
 * ATTRIBUTION_WINDOW_DAYS later count for that post. Cancelled, returned and refunded orders are left out, as in the Ad
 * Manager attribution. Comments without a trigger leave no record, so they are not counted.
 *
 * Read-only: it never writes to the store.
 */
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { orderRepository } from "@/domains/orders/order.repository";
import type { CommentTriggerChannel, CommentTriggerEvent, Conversation } from "@/types/social";
import type { Order } from "@/types/commerce";
import { rangeFor } from "./meta-graph-reader";

export const ATTRIBUTION_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const NOT_SOLD = new Set(["CANCELLED", "RETURNED", "REFUNDED"]);

export interface PostSalesRow {
  /** The post id as Meta sent it with the comment (Facebook: `<page>_<post>`; Instagram: the media id). */
  post_id: string;
  channel_type: CommentTriggerChannel;
  matched_comments: number;
  messages_sent: number;
  /** Commenters who wrote back in the inbox after the message. */
  replied: number;
  /** Customers credited to this post who placed at least one counted order. */
  customers: number;
  orders: number;
  revenue: number;
}

export interface PostSalesReport {
  range: { since: string; until: string; days: number };
  currency: string;
  window_days: number;
  totals: Omit<PostSalesRow, "post_id" | "channel_type">;
  /** Orders in another currency are not summed. */
  other_currency_orders: number;
  /** Most revenue first. */
  posts: PostSalesRow[];
}

type OrderLike = Pick<Order, "customer_id" | "status" | "created_at" | "grand_total" | "currency">;

const PREFIX: Record<CommentTriggerChannel, string> = { FACEBOOK_MESSENGER: "fb_conv_", INSTAGRAM: "ig_conv_" };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure attribution over one tenant's rows (exported for tests). */
export function attributePostSales(input: {
  events: CommentTriggerEvent[];
  conversations: Conversation[];
  orders: OrderLike[];
  sinceMs: number;
  untilMs: number;
  currency: string;
  windowDays?: number;
}): Omit<PostSalesReport, "range" | "window_days"> {
  const windowMs = (input.windowDays ?? ATTRIBUTION_WINDOW_DAYS) * DAY_MS;
  const inRange = input.events.filter((e) => {
    const at = new Date(e.created_at).getTime();
    return e.post_id && at >= input.sinceMs && at <= input.untilMs;
  });

  const conversationByKey = new Map<string, Conversation>();
  // The tenant is part of the key, so rows from another workspace can never be joined even if a caller mixes them
  for (const c of input.conversations) conversationByKey.set(`${c.tenant_id}|${c.channel_id}|${c.external_conversation_id}`, c);

  const rows = new Map<string, PostSalesRow & { repliedCustomers: Set<string>; soldCustomers: Set<string> }>();
  const rowFor = (e: CommentTriggerEvent) => {
    const key = e.post_id as string;
    let row = rows.get(key);
    if (!row) {
      row = { post_id: key, channel_type: e.channel_type, matched_comments: 0, messages_sent: 0, replied: 0, customers: 0, orders: 0, revenue: 0, repliedCustomers: new Set(), soldCustomers: new Set() };
      rows.set(key, row);
    }
    return row;
  };

  // Each customer is credited to the first post whose message they answered
  const firstTouch = new Map<string, { at: number; post: string }>();
  for (const e of inRange) {
    const row = rowFor(e);
    row.matched_comments++;
    if (e.status !== "SENT" || !e.recipient_id || !e.sent_at) continue;
    row.messages_sent++;
    const sentAt = new Date(e.sent_at).getTime();
    const conversation = conversationByKey.get(`${e.tenant_id}|${e.channel_id}|${PREFIX[e.channel_type]}${e.recipient_id}`);
    const lastInbound = conversation?.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : NaN;
    if (!conversation?.customer_id || !(lastInbound >= sentAt)) continue;
    row.repliedCustomers.add(conversation.customer_id);
    const prev = firstTouch.get(conversation.customer_id);
    if (!prev || sentAt < prev.at) firstTouch.set(conversation.customer_id, { at: sentAt, post: e.post_id as string });
  }

  let otherCurrency = 0;
  for (const o of input.orders) {
    const touch = firstTouch.get(o.customer_id);
    if (!touch || NOT_SOLD.has(o.status)) continue;
    const at = new Date(o.created_at).getTime();
    if (at < touch.at || at > touch.at + windowMs) continue;
    if ((o.currency || input.currency) !== input.currency) {
      otherCurrency++;
      continue;
    }
    const row = rows.get(touch.post);
    if (!row) continue;
    row.orders++;
    row.revenue += Number(o.grand_total) || 0;
    row.soldCustomers.add(o.customer_id);
  }

  const posts: PostSalesRow[] = [...rows.values()]
    .map(({ repliedCustomers, soldCustomers, ...row }) => ({ ...row, replied: repliedCustomers.size, customers: soldCustomers.size, revenue: round2(row.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || b.matched_comments - a.matched_comments);

  const totals = posts.reduce(
    (t, p) => ({
      matched_comments: t.matched_comments + p.matched_comments,
      messages_sent: t.messages_sent + p.messages_sent,
      replied: t.replied + p.replied,
      customers: t.customers + p.customers,
      orders: t.orders + p.orders,
      revenue: round2(t.revenue + p.revenue),
    }),
    { matched_comments: 0, messages_sent: 0, replied: 0, customers: 0, orders: 0, revenue: 0 }
  );

  return { currency: input.currency, totals, other_currency_orders: otherCurrency, posts };
}

export class PostSalesService {
  public static async getReport(context: RequestContext, days: number, now = new Date()): Promise<PostSalesReport> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_ANALYTICS_READ);
    // Revenue and order counts are order data
    RbacService.assertCan(context, PERMISSIONS.ORDERS_READ);
    const tenantId = context.tenant.id;
    const currency = context.tenant.currency || "BDT";
    const range = rangeFor(days, now);
    const events = db.getCommentTriggerEventsInRange(tenantId, range.since, range.until);
    const conversations = db.getAllConversations(tenantId).filter((c) => c.channel_type === "FACEBOOK_MESSENGER" || c.channel_type === "INSTAGRAM");
    // Orders can follow a message up to the window after the range ends, but never later than now
    const ordersUntil = new Date(Math.min(range.untilMs + ATTRIBUTION_WINDOW_DAYS * DAY_MS, now.getTime())).toISOString();
    const orders = events.some((e) => e.status === "SENT") ? await orderRepository.findInWindow(tenantId, range.since, ordersUntil) : [];
    const result = attributePostSales({ events, conversations, orders, sinceMs: range.sinceMs, untilMs: range.untilMs, currency });
    return { range: { since: range.since, until: range.until, days }, window_days: ATTRIBUTION_WINDOW_DAYS, ...result };
  }
}
