import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Conversation, ConversationStatus, ChannelType, ConversationSource } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AuditService } from "@/domains/audit/service";
import { NotFoundError, BadRequestError } from "@/lib/errors";
import { ConversationStateMachine } from "./state-machine";

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
    return db.getConversations(context.tenant.id, options);
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
      mode: "HUMAN",
      automation_paused: false,
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
    return this.updateStatus(context, conversationId, "RESOLVED");
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
    return db.updateConversation(context.tenant.id, conversationId, {
      automation_paused: paused,
      mode: paused ? "HUMAN" : "AUTOMATION",
    });
  }
}
