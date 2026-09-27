/**
 * CommerceOS Phase 5: Inventory Operations Agent
 * Inspects warehouse stocks, calculates stockout risk, and prepares reorder proposals.
 */

import { BaseAgent } from "@/domains/ai/agents/base-agent";
import { AgentType } from "@/types/ai";
import { ModelTier } from "@/domains/ai/providers/model-router";
import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";

export class InventoryAgent extends BaseAgent {
  public readonly agentType: AgentType = "INVENTORY";
  public readonly allowedTools: string[] = ["check_inventory", "get_product_details"];
  public readonly modelTier: ModelTier = "TIER_1_FAST";
  public override readonly maxIterations: number = 4;
  public override readonly timeoutMs: number = 10000;

  /**
   * Deterministic inventory check without hallucination
   */
  public checkStock(
    context: RequestContext,
    variantId: string
  ): { available: number; reserved: number; low_stock: boolean } {
    const items = db.getInventory(context.tenant.id).filter(
      (i) => i.product_variant_id === variantId
    );
    const available = items.reduce((acc: number, i) => acc + i.quantity_available, 0);
    const reserved = items.reduce((acc: number, i) => acc + i.quantity_reserved, 0);
    const lowStockThreshold = 5;

    return {
      available,
      reserved,
      low_stock: available <= lowStockThreshold,
    };
  }
}

export const inventoryAgent = new InventoryAgent();
