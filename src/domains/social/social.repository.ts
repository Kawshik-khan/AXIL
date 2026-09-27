/**
 * CommerceOS — Social Commerce Repository
 * Conversations, messages, and connected channels.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { Conversation, SocialMessage, ConnectedChannel } from '@/types/social';

export class SocialRepository extends BaseRepository<Conversation & Record<string, unknown>> {
  constructor() {
    super('conversations', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findConversationById(tenantId: string, id: string): Promise<Conversation | null> {
    if (!this.isNeonConfigured()) {
      return db.findConversationById(tenantId, id) || null;
    }
    return queryOne<Conversation>(
      `SELECT * FROM conversations WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
  }

  async findConversationByExternalId(
    tenantId: string,
    channelId: string,
    externalId: string
  ): Promise<Conversation | null> {
    if (!this.isNeonConfigured()) {
      return db.findConversationByExternalId(tenantId, channelId, externalId) || null;
    }
    return queryOne<Conversation>(
      `SELECT * FROM conversations WHERE tenant_id = $1 AND channel_id = $2 AND metadata->>'external_id' = $3 LIMIT 1`,
      [tenantId, channelId, externalId]
    );
  }

  async listConversations(tenantId: string, options?: any): Promise<{ conversations: Conversation[]; total: number }> {
    if (!this.isNeonConfigured()) {
      return db.getConversations(tenantId, options);
    }

    let whereSQL = `tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (options?.channel_id) {
      whereSQL += ` AND channel_id = $${idx++}`;
      params.push(options.channel_id);
    }
    if (options?.status) {
      whereSQL += ` AND status = $${idx++}`;
      params.push(options.status);
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM conversations WHERE ${whereSQL}`,
      params
    );
    const total = parseInt(countRes[0]?.count || '0', 10);

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const conversations = await query<Conversation>(
      `SELECT * FROM conversations WHERE ${whereSQL} ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    return { conversations, total };
  }

  async createConversation(conv: Conversation): Promise<Conversation> {
    if (!this.isNeonConfigured()) {
      return db.createConversation(conv);
    }

    const created = await queryOne<Conversation>(
      `INSERT INTO conversations (
        id, tenant_id, channel_id, channel_type, customer_id, status,
        priority, assigned_user_id, unread_count, last_message_at, tags, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        conv.id,
        conv.tenant_id,
        conv.channel_id,
        conv.channel_type,
        conv.customer_id,
        conv.status || 'OPEN',
        conv.priority || 'NORMAL',
        conv.assigned_user_id || null,
        conv.unread_count || 0,
        conv.last_message_at || new Date().toISOString(),
        JSON.stringify(conv.tags || []),
        JSON.stringify(conv.metadata || {}),
        conv.created_at || new Date().toISOString(),
        conv.updated_at || new Date().toISOString(),
      ]
    );

    db.createConversation(conv);
    return created || conv;
  }

  async saveMessage(msg: SocialMessage): Promise<SocialMessage> {
    if (!this.isNeonConfigured()) {
      return db.createSocialMessage(msg);
    }

    const created = await queryOne<SocialMessage>(
      `INSERT INTO messages (
        id, tenant_id, conversation_id, direction, sender_type,
        sender_id, message_type, text, attachments, status, idempotency_key, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        msg.id,
        msg.tenant_id,
        msg.conversation_id,
        msg.direction,
        msg.sender_type,
        msg.sender_id || null,
        msg.message_type || 'TEXT',
        msg.content || msg.text || '',
        JSON.stringify(msg.attachments || []),
        msg.status || 'PROCESSED',
        msg.idempotency_key || null,
        JSON.stringify(msg.metadata || {}),
        msg.created_at || new Date().toISOString(),
      ]
    );

    db.createSocialMessage(msg);
    return created || msg;
  }

  async getMessages(tenantId: string, conversationId: string): Promise<SocialMessage[]> {
    if (!this.isNeonConfigured()) {
      return db.getSocialMessages(tenantId, conversationId);
    }
    return query<SocialMessage>(
      `SELECT * FROM messages WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at ASC`,
      [tenantId, conversationId]
    );
  }
}

export const socialRepository = new SocialRepository();
