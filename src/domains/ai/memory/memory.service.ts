import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 4: Conversation & Customer Memory Service
 * Manages rolling multi-turn summaries. (Customer memory was read but never written; removed in FX-85, audit F20.)
 * Invariant: Memory is never treated as authoritative commerce state.
 */

import { db } from "@/infrastructure/db";
import { ConversationSummary, CanonicalIntent } from "@/types/ai";
import { modelRouter } from "@/domains/ai/providers/model-router";

export class MemoryService {
  /**
   * Retrieves active conversation summary
   */
  public static getConversationSummary(
    tenantId: string,
    conversationId: string
  ): ConversationSummary | undefined {
    return db.getConversationSummary(tenantId, conversationId);
  }

  /**
   * Generates or updates multi-turn conversation summary when history grows
   */
  public static async updateConversationSummary(
    tenantId: string,
    conversationId: string,
    currentIntent?: CanonicalIntent
  ): Promise<ConversationSummary | undefined> {
    const { messages } = db.getMessages(tenantId, conversationId, { limit: 15 });
    if (messages.length < 4) {
      return undefined; // Summary only needed when conversation has substance
    }

    const transcript = messages
      .map((m) => `${m.sender_type}: ${m.text}`)
      .join("\n");

    const prompt = `Summarize the following customer conversation for an e-commerce agent. Extract key customer facts and open issues. Keep under 3 sentences:\n\n${transcript}`;

    let summaryText = "";
    try {
      summaryText = await modelRouter.getActiveProvider("TIER_1_FAST").provider.generate(prompt);
    } catch {
      summaryText = `Customer inquiry regarding ${currentIntent || "store items"}.`;
    }

    const existing = db.getConversationSummary(tenantId, conversationId);
    const summary: ConversationSummary = {
      id: existing?.id || `csum_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      conversation_id: conversationId,
      summary_text: summaryText.trim(),
      key_facts: [
        `Last intent: ${currentIntent || "GENERAL"}`,
        `Messages exchanged: ${messages.length}`,
      ],
      customer_intent: currentIntent || "UNKNOWN",
      open_issues: [],
      last_message_index: messages.length,
      model: modelRouter.resolveModelName("TIER_1_FAST"),
      version: (existing?.version || 0) + 1,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.saveConversationSummary(summary);
  }
}
