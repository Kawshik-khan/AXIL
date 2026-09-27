/**
 * CommerceOS Phase 4: Product Information Agent
 * Specializes in detailed catalog attributes, size chart explanations, and care guidelines.
 */

import { BaseAgent } from "./base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";

export class ProductInfoAgent extends BaseAgent {
  public readonly agentType: AgentType = "PRODUCT_INFO";
  public readonly modelTier: ModelTier = "TIER_1_FAST";
  public readonly allowedTools = [
    "search_products",
    "get_product",
    "check_inventory",
    "search_knowledge",
  ];
}
