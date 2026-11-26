import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Conversation, ConversationStatus, ChannelType, ConversationSource, Message } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AuditService } from "@/domains/audit/service";
import { NotFoundError, BadRequestError } from "@/lib/errors";
import { ConversationStateMachine } from "./state-machine";
import { loadCustomerRows } from "@/infrastructure/db/tenant-rows";
import { ConversationControlService, controlOf, initialControlFields } from "./conversation-control.service";
import { agentMode, channelAllowed } from "@/domains/ai/customer-agent/jobs";
import { HitlEscalationService } from "@/domains/ai/hitl/hitl-escalation.service";
import { isCurrentHandoff, queueOf, replyDue, waitingSince, type InboxConversation, type InboxMeta, type InboxQueue, type InboxQueueFilter } from "./inbox-queue";

/** The order the inbox groups its chats in. */
const QUEUE_ORDER: Record<InboxQueue, number> = { NEEDS_PERSON: 0, AGENT: 1, TEAM: 2, DONE: 3 };
const PREVIEW_CHARS = 160;

export class ConversationService {
  public static async listConversations(
    context: RequestContext,
    options?: {
      channel_id?: string;
      channel_type?: string;
      status?: string;
      priority?: string;
      assigned_user_id?: string;
      assigned_team_id?: string;
      unread_only?: boolean;
      tag?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_READ);
    // Zero-hydration: the customers the inbox shows and searches (name, phone), from Postgres in one query each
    const customerIds = [...new Set(db.getAllConversations(context.tenant.id).map((c) => c.customer_id).filter(Boolean))];
    await loadCustomerRows(context.tenant.id, customerIds);
    return db.getConversations(context.tenant.id, options);
  }

  /**
   * The inbox: a page of conversations with their queue, owner and last message, plus the counts of every queue and
   * channel (from all conversations, not the page). Reads only. Message text needs `social.message.read` and tickets
   * `support.read`, as on their own routes: without them those fields are left out.
   */
  public static async listInbox(
    context: RequestContext,
    options: { id?: string; queue?: InboxQueueFilter; channel_type?: string; search?: string; unread_only?: boolean; tag?: string; limit?: number; offset?: number }
  ): Promise<{ conversations: InboxConversation[]; meta: InboxMeta }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_READ);
    const tenantId = context.tenant.id;
    const all = db.getAllConversations(tenantId);
    const canReadMessages = RbacService.can(context, PERMISSIONS.SOCIAL_MESSAGE_READ);
    const canReadTickets = RbacService.can(context, PERMISSIONS.SUPPORT_READ);

    const mode = agentMode(tenantId);
    const answersByChannel = new Map<string, boolean>();
    const agentAnswers = (c: Conversation): boolean => {
      const key = `${c.channel_type}|${c.channel_id}`;
      let answers = answersByChannel.get(key);
      if (answers === undefined) {
        answers = mode === "AUTONOMOUS" && channelAllowed(tenantId, c.channel_type, c.channel_id);
        answersByChannel.set(key, answers);
      }
      return answers;
    };

    // Several tickets can be open for one chat: the oldest sets when a person should have answered, the newest draft counts
    const chats = new Map(all.map((c) => [c.id, c]));
    const tickets = (canReadTickets ? db.getAgentHitlEscalations(tenantId) : [])
      .filter((e) => {
        const chat = chats.get(e.conversation_id);
        return e.status !== "RESOLVED" && chat && isCurrentHandoff(chat, e.created_at);
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const escalations = new Map(tickets.map((e) => [e.conversation_id, e]));
    const drafts = new Map([...tickets].reverse().filter((e) => HitlEscalationService.draftIsOpen(tenantId, e)).map((e) => [e.conversation_id, e]));
    const ownerIdOf = (c: Conversation): string | undefined => c.assigned_user_id ?? controlOf(c).owner_user_id;

    const queues: InboxMeta["queues"] = { NEEDS_PERSON: 0, AGENT: 0, TEAM: 0, DONE: 0, mine: 0, oldest_waiting_since: null };
    const queueById = new Map<string, InboxQueue>();
    const dueById = new Map<string, number>();
    for (const c of all) {
      const queue = queueOf(c, agentAnswers(c));
      queueById.set(c.id, queue);
      queues[queue]++;
      if (queue === "TEAM" && ownerIdOf(c) === context.user.id) queues.mine++;
      if (queue !== "NEEDS_PERSON") continue;
      const since = waitingSince(c);
      if (!queues.oldest_waiting_since || Date.parse(since) < Date.parse(queues.oldest_waiting_since)) queues.oldest_waiting_since = since;
      const due = replyDue({ ...c, escalation: escalations.get(c.id) })?.due;
      if (due) dueById.set(c.id, Date.parse(due));
    }

    const { queue, id, ...filters } = options;
    const inQueue = (c: Conversation): boolean => {
      if (id && c.id !== id) return false;
      const own = queueById.get(c.id);
      return !queue || (queue === "OPEN" ? own !== "DONE" : own === queue);
    };
    const channels: Record<string, number> = {};
    for (const c of all) if (inQueue(c)) channels[c.channel_type] = (channels[c.channel_type] ?? 0) + 1;

    // By group, then (for chats that need a person) the reply due first, then the newest message
    const groupOf = (c: Conversation): number => QUEUE_ORDER[queueById.get(c.id) ?? "DONE"];
    const dueOf = (c: Conversation): number => dueById.get(c.id) ?? Number.MAX_SAFE_INTEGER;
    const compare = (a: Conversation, b: Conversation): number =>
      groupOf(a) - groupOf(b) || dueOf(a) - dueOf(b) || Date.parse(b.last_message_at) - Date.parse(a.last_message_at);

    // Searching matches every customer's name and phone; otherwise only the page's customers are read
    if (options.search) await loadCustomerRows(tenantId, [...new Set(all.map((c) => c.customer_id).filter(Boolean))]);
    // The page's customers are attached below, once loaded: without a search none are in the working set yet
    const page = db.getConversations(tenantId, { ...filters, where: inQueue, compare, with_customers: false });
    if (!options.search) await loadCustomerRows(tenantId, [...new Set(page.conversations.map((c) => c.customer_id).filter(Boolean))]);
    const latest = canReadMessages ? db.getLatestMessages(tenantId, page.conversations.map((c) => c.id)) : new Map<string, Message>();

    const conversations = page.conversations.map((c): InboxConversation => {
      const ownerId = ownerIdOf(c);
      // Only a member of this workspace is named
      const owner = ownerId && db.findMembership(tenantId, ownerId) ? db.findUserById(ownerId) : undefined;
      const message = latest.get(c.id);
      const ticket = escalations.get(c.id);
      const draft = drafts.get(c.id);
      return {
        ...c,
        customer: db.findCustomerById(tenantId, c.customer_id),
        queue: queueById.get(c.id) ?? "DONE",
        agent_answers: agentAnswers(c),
        ...(owner ? { owner: { id: owner.id, name: owner.name } } : {}),
        ...(message
          ? {
              last_message: {
                text: message.text.slice(0, PREVIEW_CHARS),
                direction: message.direction,
                sender_type: message.sender_type,
                message_type: message.message_type,
                is_ai: message.sender_type === "BOT" || Boolean(message.metadata?.is_ai),
                created_at: message.created_at,
              },
            }
          : {}),
        ...(ticket
          ? {
              escalation: {
                id: ticket.id,
                trigger_reason: ticket.trigger_reason,
                priority: ticket.priority,
                sla_due_at: ticket.sla_due_at,
                created_at: ticket.created_at,
                ...(draft?.order_draft ? { order_draft: draft.order_draft, draft_ticket_id: draft.id } : {}),
              },
            }
          : {}),
      };
    });

    return { conversations, meta: { total: page.total, agent_mode: mode, viewer_id: context.user.id, queues, channels } };
  }

  public static async getConversationById(
    context: RequestContext,
    conversationId: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_READ);
    const conversation = db.findConversationById(context.tenant.id, conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation '${conversationId}' not found.`);
    }
    return conversation;
  }

  public static async findOrCreateConversation(
    tenantId: string,
    channelId: string,
    channelType: ChannelType,
    customerId: string,
    externalConversationId: string,
    metadata?: {
      source?: ConversationSource;
      sourceCampaign?: string;
      sourceAd?: string;
      sourcePost?: string;
      sourceStory?: string;
      sourceUrl?: string;
      referralMetadata?: Record<string, unknown>;
    }
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    const existing = db.findConversationByExternalId(tenantId, channelId, externalConversationId);
    if (existing) {
      // Reopen conversation if it was resolved or closed
      if (existing.status === "RESOLVED" || existing.status === "CLOSED") {
        const reopened = db.updateConversation(tenantId, existing.id, {
          status: "OPEN",
          last_message_at: new Date().toISOString(),
          last_inbound_at: new Date().toISOString(),
        });
        return { conversation: reopened, isNew: false };
      }

      // MessageService increments unread only after it confirms the provider message is not a duplicate.
      const updated = db.updateConversation(tenantId, existing.id, {
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
      });
      return { conversation: updated, isNew: false };
    }

    // Determine source
    let source: ConversationSource = metadata?.source || "OTHER";
    if (channelType === "FACEBOOK_MESSENGER") source = "FACEBOOK";
    else if (channelType === "INSTAGRAM") source = "INSTAGRAM";
    else if (channelType === "WHATSAPP") source = "WHATSAPP";
    else if (channelType === "WEBSITE_CHAT") source = "WEBSITE";

    const newConversation: Conversation = {
      id: `cnv_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      channel_id: channelId,
      channel_type: channelType,
      customer_id: customerId,
      external_conversation_id: externalConversationId,
      status: "OPEN",
      priority: "NORMAL",
      ...initialControlFields(tenantId),
      last_message_at: new Date().toISOString(),
      last_inbound_at: new Date().toISOString(),
      unread_count: 0,
      tags: ["NEW_CUSTOMER"],
      source,
      source_campaign: metadata?.sourceCampaign,
      source_ad: metadata?.sourceAd,
      source_post: metadata?.sourcePost,
      source_story: metadata?.sourceStory,
      source_url: metadata?.sourceUrl,
      referral_metadata: metadata?.referralMetadata,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const created = db.createConversation(newConversation);
    return { conversation: created, isNew: true };
  }

  public static async updateStatus(
    context: RequestContext,
    conversationId: string,
    newStatus: ConversationStatus
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_MANAGE);
    const existing = await this.getConversationById(context, conversationId);

    ConversationStateMachine.assertValidTransition(existing.status, newStatus);

    const updated = db.updateConversation(context.tenant.id, conversationId, {
      status: newStatus,
    });

    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "CONVERSATION_STATUS_CHANGED",
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: { from: existing.status, to: newStatus },
    });

    return updated;
  }

  public static async assignConversation(
    context: RequestContext,
    conversationId: string,
    assignedUserId?: string,
    assignedTeamId?: "SALES" | "SUPPORT" | "ORDERS" | "RETURNS" | "FINANCE" | "GENERAL",
    notes?: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_ASSIGN);
    const existing = await this.getConversationById(context, conversationId);
    if (assignedUserId && !db.findMembership(context.tenant.id, assignedUserId)) {
      throw new BadRequestError("A chat can only be assigned to a member of this workspace.");
    }

    // Record assignment audit record
    db.createAssignment({
      id: `asg_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      conversation_id: conversationId,
      assigned_user_id: assignedUserId,
      assigned_team_id: assignedTeamId,
      assigned_by: context.user.id,
      assigned_at: new Date().toISOString(),
      notes,
    });

    const updated = db.updateConversation(context.tenant.id, conversationId, {
      assigned_user_id: assignedUserId,
      assigned_team_id: assignedTeamId,
    });

    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "CONVERSATION_ASSIGNED",
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: { assignedUserId, assignedTeamId, previousUser: existing.assigned_user_id },
    });

    return updated;
  }

  public static async resolveConversation(
    context: RequestContext,
    conversationId: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_RESOLVE);
    const updated = await this.updateStatus(context, conversationId, "RESOLVED");
    // A resolved chat no longer needs a person: close its open escalation tickets in this same unit, so they leave the
    // HITL queue and stop counting against the SLA. Who controls the chat (bot or human) is left as it is.
    for (const ticket of db.getAgentHitlEscalations(context.tenant.id)) {
      if (ticket.conversation_id !== conversationId || ticket.status === "RESOLVED") continue;
      HitlEscalationService.resolveEscalation(context.tenant.id, {
        escalationId: ticket.id,
        resolutionType: "CHAT_RESOLVED",
        userId: context.user.id,
      });
    }
    return updated;
  }

  public static async reopenConversation(
    context: RequestContext,
    conversationId: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_MANAGE);
    return this.updateStatus(context, conversationId, "OPEN");
  }

  public static async markAsRead(
    context: RequestContext,
    conversationId: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_READ);
    await this.getConversationById(context, conversationId);
    return db.updateConversation(context.tenant.id, conversationId, {
      unread_count: 0,
    });
  }

  public static async addTag(
    context: RequestContext,
    conversationId: string,
    tag: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_MANAGE);
    const conv = await this.getConversationById(context, conversationId);
    const cleanTag = tag.trim().toUpperCase();
    if (!conv.tags.includes(cleanTag)) {
      const newTags = [...conv.tags, cleanTag];
      return db.updateConversation(context.tenant.id, conversationId, { tags: newTags });
    }
    return conv;
  }

  public static async removeTag(
    context: RequestContext,
    conversationId: string,
    tag: string
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_MANAGE);
    const conv = await this.getConversationById(context, conversationId);
    const cleanTag = tag.trim().toUpperCase();
    const newTags = conv.tags.filter((t) => t !== cleanTag);
    return db.updateConversation(context.tenant.id, conversationId, { tags: newTags });
  }

  public static async setAutomationPaused(
    context: RequestContext,
    conversationId: string,
    paused: boolean
  ): Promise<Conversation> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CONVERSATION_MANAGE);
    if (!db.findConversationById(context.tenant.id, conversationId)) throw new NotFoundError("Conversation", conversationId);
    // Resuming answers what waited (ConversationControlService.transition to BOT)
    return ConversationControlService.transition(
      context.tenant.id,
      conversationId,
      paused ? "HUMAN" : "BOT",
      `user:${context.user.id}`,
      paused ? "inbox_pause" : "inbox_resume",
      { ownerUserId: context.user.id }
    ).conversation;
  }
}
