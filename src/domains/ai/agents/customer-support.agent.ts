/**
 * CommerceOS Phase 4: Customer Support Agent
 * Specializes in store FAQs, shipping charges (from the workspace settings), return guidelines, and empathetic responses.
 */

import { BaseAgent } from "./base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";

export class CustomerSupportAgent extends BaseAgent {
  public readonly agentType: AgentType = "CUSTOMER_SUPPORT";
  public readonly modelTier: ModelTier = "TIER_1_FAST";
  public readonly allowedTools = [
    "search_knowledge",
    "get_order_status",
    "get_shipment_status",
    "get_shipping_estimate",
    "get_payment_status",
    "request_human_handoff",
  ];
}
