import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Message, NormalizedIncomingMessage } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BanglishNormalizer } from "../identity/banglish-normalizer";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export class MessageService {
  public static async listMessages(
    context: RequestContext,
    conversationId: string,
    options?: { cursor?: string; limit?: number; direction?: "before" | "after" }
  ) {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_READ);
    return db.getMessages(context.tenant.id, conversationId, options);
  }

  public static async getMessageById(
    context: RequestContext,
    messageId: string
  ): Promise<Message> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_READ);
    const msg = db.findMessageById(context.tenant.id, messageId);
    if (!msg) {
      throw new NotFoundError(`Message '${messageId}' not found.`);
    }
    return msg;
  }

  /**
   * Process and persist an inbound normalized message
   */
  public static async processInboundMessage(
    tenantId: string,
    conversationId: string,
    normalized: NormalizedIncomingMessage
  ): Promise<{ message: Message; isDuplicate: boolean }> {
    // 1. Idempotency Check
    if (normalized.externalMessageId) {
      const existing = db.findMessageByExternalId(tenantId, normalized.channelId, normalized.externalMessageId);
      if (existing) {
        return { message: existing, isDuplicate: true };
      }
    }

    // 2. Bangla/Banglish Analysis (Preserves original text)
    const analysis = BanglishNormalizer.analyze(normalized.text);

    // 3. Create message record
    const messageRecord: Message = {
      id: `msg_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      conversation_id: conversationId,
      external_message_id: normalized.externalMessageId,
      direction: "INBOUND",
      sender_type: "CUSTOMER",
      sender_external_id: normalized.externalSenderId,
      message_type: normalized.messageType,
      text: normalized.text,
      normalized_text: analysis.normalizedText,
      status: "PROCESSED",
      provider_timestamp: normalized.timestamp,
      retry_count: 0,
      metadata: {
        detected_intent: analysis.detectedIntent,
        extracted_phone: analysis.extractedPhone,
        extracted_order_number: analysis.extractedOrderNumber,
        source_metadata: normalized.sourceMetadata,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = db.createMessage(messageRecord);

    // Increment conversation unread count on inbound customer message
    if (normalized.direction === "INBOUND") {
      const conv = db.findConversationById(tenantId, conversationId);
      if (conv) {
        db.updateConversation(tenantId, conversationId, {
          unread_count: conv.unread_count + 1,
          last_message_at: new Date().toISOString(),
          last_inbound_at: new Date().toISOString(),
        });
      }
    }

    return { message: saved, isDuplicate: false };
  }

  /**
   * Create an internal note in the conversation thread
   * CRITICAL: Must NEVER be delivered to external channels!
   */
  public static async createInternalNote(
    context: RequestContext,
    conversationId: string,
    noteText: string
  ): Promise<Message> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);

    if (!noteText || !noteText.trim()) {
      throw new BadRequestError("Internal note content cannot be empty.");
    }

    const conversation = db.findConversationById(context.tenant.id, conversationId);
    if (!conversation) {
      throw new NotFoundError(`Conversation '${conversationId}' not found.`);
    }

    const noteRecord: Message = {
      id: `not_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      conversation_id: conversationId,
      direction: "OUTBOUND",
      sender_type: "AGENT",
      sender_id: context.user.id,
      message_type: "INTERNAL_NOTE",
      text: noteText.trim(),
      status: "PROCESSED",
      retry_count: 0,
      metadata: {
        author_name: context.user.name,
        author_email: context.user.email,
        is_internal_only: true,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const saved = db.createMessage(noteRecord);

    // Update conversation last message timestamp without touching external customer unread
    db.updateConversation(context.tenant.id, conversationId, {
      last_message_at: new Date().toISOString(),
    });

    return saved;
  }
}
