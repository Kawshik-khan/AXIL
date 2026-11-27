/**
 * CommerceOS Phase 7: Governed Marketing & Growth AI Tools
 * Strictly bounded, tenant-isolated tools for audiences, lifecycle, recommendations, content and consent.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { audienceService } from "@/domains/growth/services/audience.service";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { productRecommendationService } from "@/domains/growth/services/product-recommendation.service";
import { contentService } from "@/domains/growth/services/content.service";
import { consentService, frequencyCappingService } from "@/domains/growth/services/consent.service";

// 1. GetAudienceTool
export class GetAudienceTool implements IAgentTool<{ audience_id: string }> {
  public readonly name = "get_audience";
  public readonly description = "Retrieve details and member count of a marketing audience.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ANALYTICS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({ audience_id: z.string() });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: { audience_id: { type: "string" } },
        required: ["audience_id"],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: { audience_id: string }) {
    const aud = audienceService.getAudience(context.tenant.id, input.audience_id);
    if (!aud) return { success: false, error: "Audience not found" };
    return { success: true, audience: aud };
  }
}

// 2. CreateAudienceTool
export class CreateAudienceTool implements IAgentTool<{ name: string; description: string; type: any }> {
  public readonly name = "create_audience";
  public readonly description = "Create a target customer audience for marketing campaigns.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.ANALYTICS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({
    name: z.string(),
    description: z.string(),
    type: z.enum(["STATIC", "DYNAMIC", "PREDICTIVE", "BEHAVIORAL", "LIFECYCLE"]),
  });
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string" },
        },
        required: ["name", "description", "type"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: any) {
    const aud = audienceService.createAudience({
      tenantId: context.tenant.id,
      name: input.name,
      description: input.description,
      type: input.type,
      ruleGroups: [],
    });
    return { success: true, audience_id: aud.id };
  }
}

// 3. EvaluateSegmentTool
export class EvaluateSegmentTool implements IAgentTool<{ audience_id: string }> {
  public readonly name = "evaluate_segment";
  public readonly description = "Evaluate membership and size of an audience against live customer records.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ANALYTICS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({ audience_id: z.string() });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: { audience_id: { type: "string" } },
        required: ["audience_id"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: { audience_id: string }) {
    const aud = audienceService.getAudience(context.tenant.id, input.audience_id);
    if (!aud) return { success: false, error: "Audience not found" };
    const res = audienceService.evaluateAudienceMembership(context.tenant.id, aud);
    return { success: true, member_count: res.memberIds.length };
  }
}

// 4. GetCustomerLifecycleTool
export class GetCustomerLifecycleTool implements IAgentTool<{ customer_id?: string }> {
  public readonly name = "get_customer_lifecycle";
  public readonly description = "Get customer lifecycle stage or distribution across the 10 stages.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.CUSTOMERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({ customer_id: z.string().optional() });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: { customer_id: { type: "string" } },
        required: [],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: { customer_id?: string }) {
    if (input.customer_id) {
      const rec = customerLifecycleService.evaluateCustomerLifecycle(context.tenant.id, input.customer_id);
      return { success: true, lifecycle: rec };
    }
    const dist = customerLifecycleService.getLifecycleDistribution(context.tenant.id);
    return { success: true, distribution: dist };
  }
}

// 5. GetProductRecommendationsTool
export class GetProductRecommendationsTool implements IAgentTool<{ product_id: string; type?: "CROSS_SELL" | "UPSELL" }> {
  public readonly name = "get_product_recommendations";
  public readonly description = "Retrieve cross-sell or upsell product recommendations for a catalog item.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PRODUCTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({
    product_id: z.string(),
    type: z.enum(["CROSS_SELL", "UPSELL"]).optional(),
  });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          type: { type: "string", enum: ["CROSS_SELL", "UPSELL"] },
        },
        required: ["product_id"],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: { product_id: string; type?: "CROSS_SELL" | "UPSELL" }) {
    const recs = input.type === "UPSELL"
      ? productRecommendationService.getUpsellRecommendations(context.tenant.id, input.product_id)
      : productRecommendationService.getCrossSellRecommendations(context.tenant.id, input.product_id);
    return { success: true, recommendations: recs };
  }
}

// 8. GenerateContentTool
export class GenerateContentTool implements IAgentTool<any> {
  public readonly name = "generate_content";
  public readonly description = "Generate culturally-authentic marketing copy in Bangla, Banglish, or English.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.PRODUCTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({
    product_id: z.string(),
    language: z.enum(["bn", "banglish", "en"]),
    channel: z.string(),
  });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          language: { type: "string" },
          channel: { type: "string" },
        },
        required: ["product_id", "language", "channel"],
      },
      timeout_ms: 4000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: any) {
    const asset = contentService.generateCopyDraft({
      tenantId: context.tenant.id,
      channel: input.channel as any,
      language: input.language,
      customerName: "Valued Customer",
      productId: input.product_id,
    });
    return { success: true, rendered_text: asset.rendered_text, verified: asset.verification_passed };
  }
}

// 9. ValidateContentTool
export class ValidateContentTool implements IAgentTool<any> {
  public readonly name = "validate_content";
  public readonly description = "Verify marketing content against Commerce Core catalog prices and inventory.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PRODUCTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({
    text: z.string(),
    product_id: z.string().optional(),
    claimed_price: z.number().optional(),
  });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          product_id: { type: "string" },
          claimed_price: { type: "number" },
        },
        required: ["text"],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: any) {
    const res = contentService.verifyContentFactuality({
      tenantId: context.tenant.id,
      text: input.text,
      productId: input.product_id,
      claimedPrice: input.claimed_price,
    });
    return { success: true, verification: res };
  }
}

// 11. CheckConsentTool
export class CheckConsentTool implements IAgentTool<any> {
  public readonly name = "check_consent";
  public readonly description = "Check if customer has valid communication consent for a marketing channel.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.CUSTOMERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({ customer_id: z.string(), channel: z.string() });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: { customer_id: { type: "string" }, channel: { type: "string" } },
        required: ["customer_id", "channel"],
      },
      timeout_ms: 2000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: any) {
    const has = consentService.hasConsent(context.tenant.id, input.customer_id, input.channel);
    return { success: true, has_consent: has };
  }
}

// 12. CheckFrequencyCapTool
export class CheckFrequencyCapTool implements IAgentTool<any> {
  public readonly name = "check_frequency_cap";
  public readonly description = "Check if customer has exceeded message frequency caps.";
  public readonly category = "MARKETING";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.CUSTOMERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = z.object({ customer_id: z.string(), channel: z.string() });
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: { customer_id: { type: "string" }, channel: { type: "string" } },
        required: ["customer_id", "channel"],
      },
      timeout_ms: 2000,
      idempotent: this.idempotent,
    };
  }

  public async execute(context: RequestContext, input: any) {
    const res = frequencyCappingService.checkFrequencyCap(context.tenant.id, input.customer_id, input.channel);
    return { success: true, is_capped: res.capped, reason: res.reason };
  }
}
