/**
 * CommerceOS Phase 4: Sales & Conversion Agent
 * Specializes in product recommendations, inventory checks, wholesale lead capture, and controlled order drafts.
 */

import { BaseAgent } from "./base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";

export class SalesAgent extends BaseAgent {
  public readonly agentType: AgentType = "SALES";
  public readonly modelTier: ModelTier = "TIER_2_REASONING";
  public readonly allowedTools = [
    "search_products",
    "get_product",
    "check_inventory",
    "create_lead",
    "calculate_checkout",
    "create_order_draft",
    "request_human_handoff",
  ];
}
