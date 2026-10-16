/**
 * Comment-to-inbox triggers. A merchant sets keywords and an offer; when someone comments a keyword on a Facebook or
 * Instagram post, the commenter gets the offer in their inbox through Meta's "private reply" (one per comment).
 *
 * - The webhook only records a PENDING event (inside its unit of work). The send happens in the background worker,
 *   outside the store lock, like the outbox dispatcher: claim in a short unit, call Meta, record the outcome.
 * - One inbox message per comment, and one per commenter per rule per post every 24 hours. Repeats aren't stored, so a
 *   commenter spamming the keyword can't grow the store.
 * - Creating, activating or rewording a trigger needs social.message.send as well as social.template.manage: a trigger
 *   sends messages on the workspace's behalf. A workspace that isn't ACTIVE sends nothing.
 * - Nothing is reported as sent unless Meta returned a message id. Missing credentials, a paused channel or the
 *   `real_messaging` flag being off end as FAILED with the reason, never as SENT.
 */
import { z } from "zod";
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { randomSuffix } from "@/lib/ids";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, BadRequestError, IntegrationNotConfiguredError, NotFoundError } from "@/lib/errors";
import { assertNotKilled, isFeatureEnabled } from "@/lib/safety-gate";
import { ChannelService } from "../channels/channel.service";
import { ChannelRateLimiter } from "../outbound/rate-limiter";
import type {
  CommentTriggerChannel,
  CommentTriggerEvent,
  CommentTriggerRule,
  ConnectedChannel,
} from "@/types/social";

const TRIGGER_CHANNELS = ["FACEBOOK_MESSENGER", "INSTAGRAM"] as const;
const MAX_RULES_PER_TENANT = 50;
const REPEAT_WINDOW_MS = 24 * 60 * 60_000;
/** Meta accepts a private reply only within 7 days of the comment. */
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const STALE_CLAIM_MS = 5 * 60_000;
export const MAX_SEND_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 30_000;
const PER_TENANT_PER_PASS = 5;

const keywordList = z.array(z.string().trim().min(1).max(60)).min(1).max(20);
const postIdList = z.array(z.string().trim().regex(/^[A-Za-z0-9_]{1,64}$/, "Post ids are letters, digits and underscores.")).max(50);

export const CommentTriggerCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    keywords: keywordList,
    channel_types: z.array(z.enum(TRIGGER_CHANNELS)).min(1).max(2),
    dm_message: z.string().trim().min(1).max(1000),
    post_ids: postIdList.default([]),
    is_active: z.boolean().default(true),
  })
  .strict();

export const CommentTriggerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    keywords: keywordList,
    channel_types: z.array(z.enum(TRIGGER_CHANNELS)).min(1).max(2),
    dm_message: z.string().trim().min(1).max(1000),
    post_ids: postIdList,
    is_active: z.boolean(),
  })
  .partial()
  .strict();

export type CommentTriggerCreateInput = z.infer<typeof CommentTriggerCreateSchema>;
export type CommentTriggerUpdateInput = z.infer<typeof CommentTriggerUpdateSchema>;

/** Lower-case, Unicode-normalized, punctuation turned into spaces. Keeps Bangla letters and their vowel signs. */
export function normalizeCommentText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

/** The first keyword the comment contains as a whole word or phrase ("price" matches "Price?" but not "priceless"). */
export function matchKeyword(keywords: string[], commentText: string): string | undefined {
  const haystack = ` ${normalizeCommentText(commentText)} `;
  return keywords.find((k) => {
    const needle = normalizeCommentText(k);
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}

export function renderOffer(template: string, values: { name?: string; keyword: string }): string {
  return template
    .replace(/\{name\}/g, () => values.name?.trim() ?? "")
    .replace(/\{keyword\}/g, () => values.keyword)
    .replace(/[ \t]+([,.!?।])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanKeywords(raw: string[]): string[] {
  const out = Array.from(new Set(raw.map(normalizeCommentText).filter(Boolean)));
  if (out.length === 0) throw new BadRequestError("Add at least one keyword with letters or numbers.");
  return out;
}

export interface MetaComment {
  commentId: string;
  postId?: string;
  commenterId: string;
  commenterName?: string;
  text: string;
  createdAt?: string;
}

type Entry = { id?: unknown; changes?: unknown };
type Change = { field?: unknown; value?: Record<string, unknown> };

/**
 * New comments in a Meta webhook payload: Facebook Page `feed` changes (item "comment", verb "add") and Instagram
 * `comments` changes. The account's own comments (the Page / business account replying) are ignored.
 */
export function parseMetaComments(channelType: CommentTriggerChannel, payload: Record<string, unknown>): MetaComment[] {
  const entries = Array.isArray(payload.entry) ? (payload.entry as Entry[]) : [];
  const out: MetaComment[] = [];
  for (const entry of entries) {
    const accountId = String(entry?.id ?? "");
    const changes = Array.isArray(entry?.changes) ? (entry.changes as Change[]) : [];
    for (const change of changes) {
      const v = change?.value;
      if (!v || typeof v !== "object") continue;
      const from = (v.from ?? {}) as { id?: unknown; name?: unknown; username?: unknown };
      const commenterId = typeof from.id === "string" ? from.id : "";
      if (!commenterId || commenterId === accountId) continue;
      if (channelType === "FACEBOOK_MESSENGER") {
        if (change.field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
        if (typeof v.comment_id !== "string" || !v.comment_id) continue;
        out.push({
          commentId: v.comment_id,
          postId: typeof v.post_id === "string" ? v.post_id : undefined,
          commenterId,
          commenterName: typeof from.name === "string" ? from.name.slice(0, 120) : undefined,
          text: typeof v.message === "string" ? v.message.slice(0, 2000) : "",
          createdAt: typeof v.created_time === "number" ? new Date(v.created_time * 1000).toISOString() : undefined,
        });
      } else {
        if (change.field !== "comments") continue;
        if (typeof v.id !== "string" || !v.id) continue;
        const media = (v.media ?? {}) as { id?: unknown };
        out.push({
          commentId: v.id,
          postId: typeof media.id === "string" ? media.id : undefined,
          commenterId,
          commenterName: typeof from.username === "string" ? from.username.slice(0, 120) : undefined,
          text: typeof v.text === "string" ? v.text.slice(0, 2000) : "",
        });
      }
    }
  }
  return out;
}

/** A rule scoped to posts matches the Facebook `pageid_postid` form or the bare post id. */
function postInScope(rule: CommentTriggerRule, postId?: string): boolean {
  if (rule.post_ids.length === 0) return true;
  if (!postId) return false;
  const bare = postId.includes("_") ? postId.slice(postId.indexOf("_") + 1) : postId;
  return rule.post_ids.includes(postId) || rule.post_ids.includes(bare);
}

let autoDispatch = true;
let dispatchInFlight = false;
/** Tests: stop the webhook from scheduling a background send (they call dispatchCommentTriggersOnce themselves). */
export function setCommentTriggerAutoDispatchForTesting(enabled: boolean): void {
  autoDispatch = enabled;
}

function scheduleDispatch(): void {
  if (!autoDispatch || process.env.CUSTOMER_AGENT_WORKER === "0") return;
  // After the webhook's unit of work commits; the worker loop picks up anything this pass misses.
  const t = setTimeout(() => {
    void dispatchCommentTriggersOnce().catch((err: unknown) =>
      logger.warn("comment_trigger.dispatch_failed", { error: err instanceof Error ? err.message : "error" })
    );
  }, 300);
  t.unref?.();
}

export class CommentTriggerService {
  public static list(context: RequestContext): CommentTriggerRule[] {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_READ);
    return db.getCommentTriggerRules(context.tenant.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  public static recentEvents(context: RequestContext, limit = 50): CommentTriggerEvent[] {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_READ);
    return db.getCommentTriggerEvents(context.tenant.id, Math.min(Math.max(limit, 1), 200));
  }

  public static create(context: RequestContext, input: CommentTriggerCreateInput): CommentTriggerRule {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_MANAGE);
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);
    if (db.getCommentTriggerRules(context.tenant.id).length >= MAX_RULES_PER_TENANT) {
      throw new BadRequestError(`A workspace can have at most ${MAX_RULES_PER_TENANT} comment triggers.`);
    }
    const now = new Date().toISOString();
    return db.saveCommentTriggerRule({
      id: `ctr_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      name: input.name,
      keywords: cleanKeywords(input.keywords),
      channel_types: Array.from(new Set(input.channel_types)),
      dm_message: input.dm_message,
      post_ids: Array.from(new Set(input.post_ids)),
      is_active: input.is_active,
      created_by: context.user.id,
      created_at: now,
      updated_at: now,
    });
  }

  public static update(context: RequestContext, id: string, input: CommentTriggerUpdateInput): CommentTriggerRule {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_MANAGE);
    const existing = db.findCommentTriggerRule(context.tenant.id, id);
    if (!existing) throw new NotFoundError(`Comment trigger '${id}' not found.`);
    // Turning a trigger on or changing what it sends is sending messages; pausing or re-scoping it is not.
    if (input.is_active === true || input.dm_message !== undefined) RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);
    return db.saveCommentTriggerRule({
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.keywords !== undefined ? { keywords: cleanKeywords(input.keywords) } : {}),
      ...(input.channel_types !== undefined ? { channel_types: Array.from(new Set(input.channel_types)) } : {}),
      ...(input.dm_message !== undefined ? { dm_message: input.dm_message } : {}),
      ...(input.post_ids !== undefined ? { post_ids: Array.from(new Set(input.post_ids)) } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      updated_at: new Date().toISOString(),
    });
  }

  public static remove(context: RequestContext, id: string): { deleted: boolean } {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_MANAGE);
    if (!db.deleteCommentTriggerRule(context.tenant.id, id)) throw new NotFoundError(`Comment trigger '${id}' not found.`);
    return { deleted: true };
  }

  /**
   * Called by the webhook for a verified Facebook / Instagram channel, inside its unit of work. Records a PENDING
   * event for each new comment that matches an active rule, and schedules the background send. Returns how many.
   */
  public static recordFromWebhook(channel: ConnectedChannel, payload: Record<string, unknown>): number {
    if (channel.type !== "FACEBOOK_MESSENGER" && channel.type !== "INSTAGRAM") return 0;
    const channelType: CommentTriggerChannel = channel.type;
    if (db.findTenantById(channel.tenant_id)?.status !== "ACTIVE") return 0;
    const rules = db
      .getCommentTriggerRules(channel.tenant_id)
      .filter((r) => r.is_active && r.channel_types.includes(channelType))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (rules.length === 0) return 0;

    let queued = 0;
    const now = Date.now();
    for (const comment of parseMetaComments(channelType, payload)) {
      if (db.findCommentTriggerEventByComment(channel.tenant_id, channel.id, comment.commentId)) continue; // redelivery
      let rule: CommentTriggerRule | undefined;
      let keyword: string | undefined;
      for (const candidate of rules) {
        if (!postInScope(candidate, comment.postId)) continue;
        keyword = matchKeyword(candidate.keywords, comment.text);
        if (keyword) {
          rule = candidate;
          break;
        }
      }
      if (!rule || !keyword) continue;

      const since = new Date(now - REPEAT_WINDOW_MS).toISOString();
      if (db.hasRecentCommentTriggerEvent(channel.tenant_id, rule.id, channel.id, comment.commenterId, comment.postId, since)) continue;
      const nowIso = new Date(now).toISOString();
      db.saveCommentTriggerEvent({
        id: `cte_${Date.now()}_${randomSuffix()}`,
        tenant_id: channel.tenant_id,
        rule_id: rule.id,
        rule_name: rule.name,
        channel_id: channel.id,
        channel_type: channelType,
        comment_id: comment.commentId,
        post_id: comment.postId,
        commenter_id: comment.commenterId,
        commenter_name: comment.commenterName,
        comment_text: comment.text.slice(0, 500),
        matched_keyword: keyword,
        message_text: renderOffer(rule.dm_message, { name: comment.commenterName, keyword }),
        status: "PENDING",
        attempts: 0,
        next_attempt_at: nowIso,
        created_at: comment.createdAt && comment.createdAt < nowIso ? comment.createdAt : nowIso,
        updated_at: nowIso,
      });
      queued++;
    }
    if (queued > 0) {
      logger.info("comment_trigger.queued", { tenant_id: channel.tenant_id, channel_id: channel.id, count: queued });
      scheduleDispatch();
    }
    return queued;
  }
}

type Outcome = Pick<CommentTriggerEvent, "status"> & Partial<CommentTriggerEvent>;

async function claim(candidate: CommentTriggerEvent, now: number): Promise<CommentTriggerEvent | undefined> {
  return db.unit(async () => {
    const current = db.findCommentTriggerEvent(candidate.tenant_id, candidate.id);
    if (!current) return undefined;
    const due = current.status === "PENDING" && current.next_attempt_at <= new Date(now).toISOString();
    const stale = current.status === "SENDING" && (current.claimed_at ?? "") < new Date(now - STALE_CLAIM_MS).toISOString();
    if (!due && !stale) return undefined;
    return db.saveCommentTriggerEvent({
      ...current,
      status: "SENDING",
      claimed_at: new Date(now).toISOString(),
      attempts: current.attempts + 1,
      updated_at: new Date(now).toISOString(),
    });
  }, (r) => Boolean(r));
}

/** Why this event must not be sent now, or undefined when it may go out. */
function blockedReason(event: CommentTriggerEvent, channel: ConnectedChannel | undefined, now: number): Outcome | undefined {
  if (db.findTenantById(event.tenant_id)?.status !== "ACTIVE") {
    return { status: "FAILED", failure_reason: "The workspace is not active. Nothing was sent." };
  }
  const rule = db.findCommentTriggerRule(event.tenant_id, event.rule_id);
  if (!rule || !rule.is_active) return { status: "SKIPPED", failure_reason: "The trigger was turned off before the message went out." };
  if (!channel || channel.status !== "ACTIVE") return { status: "FAILED", failure_reason: "The channel is disconnected. Nothing was sent." };
  if (now - new Date(event.created_at).getTime() > PRIVATE_REPLY_WINDOW_MS) {
    return { status: "FAILED", failure_reason: "Meta only allows an inbox reply within 7 days of the comment. Nothing was sent." };
  }
  try {
    assertNotKilled(event.tenant_id, "CHANNEL", channel.id, channel.type);
  } catch (err) {
    return { status: "FAILED", failure_reason: err instanceof Error ? err.message : "Messaging is paused. Nothing was sent." };
  }
  if (!isFeatureEnabled("real_messaging", event.tenant_id)) {
    return { status: "FAILED", failure_reason: "Real messaging is not enabled for this workspace. Nothing was sent." };
  }
  return undefined;
}

async function send(event: CommentTriggerEvent, now: number): Promise<Outcome> {
  const channel = db.findConnectedChannelById(event.tenant_id, event.channel_id);
  const blocked = blockedReason(event, channel, now);
  if (blocked || !channel) return blocked ?? { status: "FAILED", failure_reason: "The channel is disconnected. Nothing was sent." };

  const rate = ChannelRateLimiter.tryConsume(channel.id);
  if (!rate.allowed) {
    // Not an attempt: wait for the channel's send bucket
    return { status: "PENDING", attempts: event.attempts - 1, next_attempt_at: new Date(now + Math.max(rate.retryAfterMs ?? 1_000, 1_000)).toISOString() };
  }
  const adapter = ChannelService.getAdapter(channel.type);
  if (!adapter.sendPrivateReply) return { status: "FAILED", failure_reason: "This channel cannot message commenters." };
  let credentials;
  try {
    credentials = ChannelService.getDecryptedCredentials(channel);
  } catch {
    return { status: "FAILED", failure_reason: "The channel's credentials could not be read. Reconnect the channel. Nothing was sent." };
  }
  try {
    const result = await adapter.sendPrivateReply(credentials, event.comment_id, event.message_text);
    return {
      status: "SENT",
      external_message_id: result.externalMessageId,
      recipient_id: result.recipientId,
      sent_at: new Date().toISOString(),
      failure_reason: undefined,
    };
  } catch (err) {
    // A timeout or lost connection may follow a message Meta accepted: don't claim nothing was sent.
    const reason =
      err instanceof AppError && /_UNREACHABLE$/.test(err.code)
        ? "No confirmation from Meta; the message may or may not have been delivered."
        : err instanceof Error ? err.message.slice(0, 300) : "Meta refused the message.";
    // Missing / expired token, missing permission or a refused request: retrying can't help.
    const permanent =
      err instanceof IntegrationNotConfiguredError || (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429);
    if (permanent || event.attempts >= MAX_SEND_ATTEMPTS) return { status: "FAILED", failure_reason: reason };
    return {
      status: "PENDING",
      failure_reason: reason,
      next_attempt_at: new Date(now + BASE_BACKOFF_MS * Math.pow(2, event.attempts - 1)).toISOString(),
    };
  }
}

/** One pass of the background sender. Exported for the worker and tests. */
export async function dispatchCommentTriggersOnce(limit = 20, now = Date.now()): Promise<{ sent: number; failed: number; retrying: number; skipped: number }> {
  const stats = { sent: 0, failed: 0, retrying: 0, skipped: 0 };
  if (dispatchInFlight) return stats; // the webhook kick and the worker loop never overlap in one server
  dispatchInFlight = true;
  try {
    const due = db.getDueCommentTriggerEvents(new Date(now).toISOString(), new Date(now - STALE_CLAIM_MS).toISOString(), 200);
    // A few per workspace per pass, so one workspace's backlog can't hold up the others
    const perTenant = new Map<string, number>();
    const picked = due
      .filter((e) => {
        const n = perTenant.get(e.tenant_id) ?? 0;
        perTenant.set(e.tenant_id, n + 1);
        return n < PER_TENANT_PER_PASS;
      })
      .slice(0, limit);
    for (const candidate of picked) await dispatchOne(candidate, now, stats);
  } finally {
    dispatchInFlight = false;
  }
  return stats;
}

type DispatchStats = { sent: number; failed: number; retrying: number; skipped: number };

async function dispatchOne(candidate: CommentTriggerEvent, now: number, stats: DispatchStats): Promise<void> {
  const event = await claim(candidate, now).catch(() => undefined); // another server took it
  if (!event) return;
  const outcome = await send(event, now);
  const written = await db.unit(async () => {
    const current = db.findCommentTriggerEvent(event.tenant_id, event.id);
    // Only the holder of the claim records the outcome, so a reclaim can't overwrite SENT
    if (!current || current.status !== "SENDING" || current.claimed_at !== event.claimed_at) return undefined;
    return db.saveCommentTriggerEvent({ ...current, ...outcome, claimed_at: undefined, updated_at: new Date().toISOString() });
  }, (r) => Boolean(r));
  if (!written) return;
  if (outcome.status === "SENT") stats.sent++;
  else if (outcome.status === "PENDING") stats.retrying++;
  else if (outcome.status === "SKIPPED") stats.skipped++;
  else stats.failed++;
  logger.info("comment_trigger.dispatched", { tenant_id: event.tenant_id, event_id: event.id, status: outcome.status });
}
