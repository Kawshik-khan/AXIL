/**
 * CommerceOS Phase 4: Context Builder
 * Assembles 5-layer bounded context with PII redaction and strict instruction hierarchy.
 */

import { createHash } from "crypto";
import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import {
  AgentContext,
  ContextAssemblyManifest,
  RetrievalCitation,
  UntrustedContextItem,
} from "@/types/ai";
import { PIIRedactionService } from "./pii-redaction.service";
import { MemoryService } from "../memory/memory.service";
import { PricingService } from "@/domains/pricing/pricing.service";

export interface BuildContextOptions {
  conversationId: string;
  queryText?: string;
  knowledgeCitations?: RetrievalCitation[];
  maxRecentMessages?: number;
}

export class ContextBuilder {
  /**
   * Assembles complete AgentContext for an agent run
   */
  public static async build(
    context: RequestContext,
    options: BuildContextOptions,
  ): Promise<AgentContext> {
    const tenantId = context.tenant.id;
    const policy = db.getAIPolicy(tenantId);

    const conversation = db.findConversationById(
      tenantId,
      options.conversationId,
    );
    const channelType = conversation?.channel_type || "WEBSITE_CHAT";
    const customerId = conversation?.customer_id;

    // Layer 1: Recent Conversation Messages (Chronological)
    const limit = options.maxRecentMessages || 8;
    const { messages: rawMessages } = db.getMessages(
      tenantId,
      options.conversationId,
      { limit },
    );
    const chronologicalMessages = [...rawMessages].reverse().map((m) => {
      const text = policy.pii_redaction_enabled
        ? PIIRedactionService.redactText(m.text)
        : m.text;
      return {
        id: m.id,
        sender_type: m.sender_type,
        text,
        created_at: m.created_at,
      };
    });

    // Layer 2: Rolling Conversation Summary
    const summary = MemoryService.getConversationSummary(
      tenantId,
      options.conversationId,
    );

    // (Layer 3, customer memory, was removed in FX-85: nothing ever wrote it, so it only ever read nothing.)

    // Layer 4: Relevant Commerce State (Recent customer orders)
    let recentOrders: Array<{
      id: string;
      order_number: string;
      status: string;
      total_amount: number;
      created_at: string;
    }> = [];
    if (customerId) {
      const orders = db.getOrders(tenantId, {
        customer_id: customerId,
        limit: 3,
      }).orders;
      recentOrders = orders.map((o) => ({
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        total_amount: o.grand_total,
        created_at: o.created_at,
      }));
    }

    // Layer 5: Retrieved Knowledge Citations
    const retrieved_knowledge = options.knowledgeCitations || [];

    // The active user turn is added as its own final message by BaseAgent. Do
    // not also spend context tokens serializing the same customer message.
    const queryForDedup = options.queryText
      ? (policy.pii_redaction_enabled
          ? PIIRedactionService.redactText(options.queryText)
          : options.queryText
        ).trim()
      : "";

    const fees = PricingService.getDeliveryFees(tenantId);
    const itemCandidates: UntrustedContextItem[] = [
      ...chronologicalMessages
        .filter(
          (message) =>
            !(
              queryForDedup &&
              message.sender_type === "CUSTOMER" &&
              message.text.trim() === queryForDedup
            ),
        )
        .map((message, index) => ({
          id: `message:${message.id}`,
          tenant_id: tenantId,
          kind: "CONVERSATION_MESSAGE" as const,
          source_id: message.id,
          channel: channelType,
          captured_at: message.created_at,
          trust_class: "UNTRUSTED_DATA" as const,
          priority: 50 + index,
          content: PIIRedactionService.redactObject({
            sender_type: message.sender_type,
            text: message.text,
          }),
        })),
      ...(summary
        ? [
            {
              id: `summary:${summary.id}`,
              tenant_id: tenantId,
              kind: "CONVERSATION_SUMMARY" as const,
              source_id: summary.id,
              source_version: summary.version,
              channel: channelType,
              captured_at: summary.updated_at,
              trust_class: "UNTRUSTED_DATA" as const,
              priority: 30,
              content: PIIRedactionService.redactObject({
                summary_text: summary.summary_text,
                key_facts: summary.key_facts,
                source_message_index: summary.last_message_index,
              }),
            },
          ]
        : []),
      ...recentOrders.map((order, index) => ({
        id: `order:${order.id}`,
        tenant_id: tenantId,
        kind: "ORDER_SNAPSHOT" as const,
        source_id: order.id,
        captured_at: order.created_at,
        trust_class: "UNTRUSTED_DATA" as const,
        priority: 80 - index,
        content: {
          order_number: order.order_number,
          status: order.status,
          total_amount: order.total_amount,
        },
      })),
      ...retrieved_knowledge.map((citation) => ({
        id: `citation:${citation.chunk_id}`,
        tenant_id: tenantId,
        kind: "RETRIEVED_DOCUMENT" as const,
        source_id: citation.document_id,
        source_version: citation.version,
        captured_at: new Date().toISOString(),
        trust_class: "UNTRUSTED_DATA" as const,
        priority: 70,
        content: PIIRedactionService.redactObject({
          title: citation.document_title,
          section: citation.section,
          chunk_id: citation.chunk_id,
          parent_chunk_id: citation.parent_chunk_id,
          query: options.queryText,
          snippet: citation.content_snippet,
          parent_content: citation.parent_content,
        }),
      })),
    ];

    // Reserve most of the run budget for system instructions, the current
    // request, tool results, and completion tokens. This is an estimate; the
    // provider-reported usage remains the authoritative accounting signal.
    const budgetTokens = Math.max(
      32,
      Math.min(4000, Math.floor(policy.max_tokens_per_run * 0.15)),
    );
    const selected: UntrustedContextItem[] = [];
    const omitted: ContextAssemblyManifest["omitted_items"] = [];
    const baseContext = {
      currency: context.tenant.currency,
      channel: channelType,
      delivery_charges_bdt: {
        inside_dhaka: fees.inside_dhaka_bdt,
        outside_dhaka: fees.outside_dhaka_bdt,
      },
    };
    const estimate = (items: UntrustedContextItem[]) =>
      Math.ceil(
        JSON.stringify({ store: baseContext, untrusted_context_items: items })
          .length / 4,
      );
    for (const item of [...itemCandidates].sort(
      (a, b) => b.priority - a.priority,
    )) {
      if (estimate([...selected, item]) <= budgetTokens) selected.push(item);
      else
        omitted.push({
          id: item.id,
          kind: item.kind,
          reason: "CONTEXT_BUDGET",
        });
    }
    const contextPayload = {
      store: baseContext,
      untrusted_context_items: selected,
    };
    const serialized = JSON.stringify(contextPayload);
    const contextManifest: ContextAssemblyManifest = {
      budget_tokens: budgetTokens,
      estimated_tokens: estimate(selected),
      selected_items: selected.map(
        ({ id, kind, source_id, source_version }) => ({
          id,
          kind,
          source_id,
          source_version,
        }),
      ),
      omitted_items: omitted,
      content_hash: createHash("sha256").update(serialized).digest("hex"),
    };

    return {
      tenant_id: tenantId,
      conversation_id: options.conversationId,
      customer_id: customerId,
      channel_type: channelType,
      recent_messages: chronologicalMessages,
      summary,
      retrieved_knowledge,
      recent_orders: recentOrders,
      policy,
      untrusted_context_items: selected,
      context_manifest: contextManifest,
    };
  }

  /**
   * Formats assembled context into system instructions and prompt sections
   * Enforces instruction hierarchy to defend against prompt injection
   */
  public static formatPromptContext(agentContext: AgentContext): string {
    // The result is serialized as data and inserted only in a user-role message.
    const fees = PricingService.getDeliveryFees(agentContext.tenant_id);
    return JSON.stringify({
      store: {
        currency: "BDT",
        channel: agentContext.channel_type,
        delivery_charges_bdt: {
          inside_dhaka: fees.inside_dhaka_bdt,
          outside_dhaka: fees.outside_dhaka_bdt,
        },
      },
      untrusted_context_items: agentContext.untrusted_context_items,
      assembly: {
        budget_tokens: agentContext.context_manifest.budget_tokens,
        estimated_tokens: agentContext.context_manifest.estimated_tokens,
        selected_items: agentContext.context_manifest.selected_items,
        omitted_items: agentContext.context_manifest.omitted_items,
      },
    });
  }
}
