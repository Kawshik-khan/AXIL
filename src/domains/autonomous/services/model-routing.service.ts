/**
 * CommerceOS Phase 10: Model Routing Service
 * Policy-controlled model routing based on task type, latency, cost, quality, data sensitivity, region.
 */

import { db } from "@/infrastructure/db";
import { ModelRoutingPolicy, AIProvider } from "@/types/autonomous";

export class ModelRoutingService {
  /** Select the best model based on routing policy and task requirements. */
  routeRequest(tenantId: string, taskType: string, requirements: {
    max_latency_ms?: number;
    max_cost_per_request?: number;
    min_quality_score?: number;
    data_sensitivity?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    region?: string;
  }): { provider_id: string; model: string; reason: string } | null {
    const providers = db.data.ai_providers.filter((p) => p.status === "ACTIVE");
    if (providers.length === 0) return null;

    // Filter by data sensitivity
    let candidates = providers;
    if (requirements.data_sensitivity === "RESTRICTED" || requirements.data_sensitivity === "CONFIDENTIAL") {
      candidates = candidates.filter((p) => p.data_residency_compliant);
    }
    if (requirements.region) {
      candidates = candidates.filter((p) => p.regions.includes(requirements.region!) || p.regions.includes("GLOBAL"));
    }
    if (requirements.max_cost_per_request) {
      candidates = candidates.filter((p) => p.cost_per_1k_input_tokens <= requirements.max_cost_per_request!);
    }

    if (candidates.length === 0) {
      // Fallback: use any available provider but note the compromise
      return {
        provider_id: providers[0].id,
        model: providers[0].supported_models[0],
        reason: "Fallback: no provider matches all criteria",
      };
    }

    // Select best match (cheapest for low-sensitivity, highest quality for high-sensitivity)
    if (requirements.data_sensitivity === "RESTRICTED") {
      candidates.sort((a, b) => (b.max_tokens || 0) - (a.max_tokens || 0));
    } else {
      candidates.sort((a, b) => a.cost_per_1k_input_tokens - b.cost_per_1k_input_tokens);
    }

    return {
      provider_id: candidates[0].id,
      model: candidates[0].supported_models[0],
      reason: `Selected ${candidates[0].name} for ${taskType} (${requirements.data_sensitivity || "PUBLIC"} sensitivity)`,
    };
  }

  /** Evaluate routing policy rules against current provider state. */
  evaluateRoutingPolicy(tenantId: string): {
    providers_available: number;
    providers_degraded: number;
    routing_healthy: boolean;
  } {
    const all = db.data.ai_providers;
    const active = all.filter((p) => p.status === "ACTIVE");
    const degraded = all.filter((p) => p.status === "DEGRADED");
    return {
      providers_available: active.length,
      providers_degraded: degraded.length,
      routing_healthy: active.length > 0,
    };
  }
}
