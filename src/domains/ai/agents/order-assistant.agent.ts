/**
 * CommerceOS Phase 4: Order Assistant Agent
 * Specializes in order lookup by tracking code, status verification, and courier tracking interpretation.
 */

import { BaseAgent } from "./base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";

export class OrderAssistantAgent extends BaseAgent {
  public readonly agentType: AgentType = "ORDER_ASSISTANT";
  public readonly modelTier: ModelTier = "TIER_2_REASONING";
  public readonly allowedTools = [
    "get_order",
    "get_order_status",
    "get_shipment_status",
    "get_payment_status",
    "request_human_handoff",
  ];
}
