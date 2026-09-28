/**
 * Explicit intelligence recompute (FIX_IMPLEMENTATION_PLAN FX-21). The only request-driven path that stores
 * intelligence snapshots; GET handlers read them (intelligence-snapshot.service.ts) and never write.
 */

import { customerIntelligenceService } from "./customer-intelligence.service";
import { productIntelligenceService } from "./product-intelligence.service";
import { inventoryIntelligenceService } from "./inventory-intelligence.service";
import { anomalyDetectorService } from "./anomaly-detector.service";
import { opportunityDetectorService } from "./opportunity-detector.service";
import { riskDetectorService } from "./risk-detector.service";
import { recommendationService } from "./recommendation.service";
import { cohortAnalysisService } from "./cohort-analysis.service";
import { dataQualityService } from "./data-quality.service";
import { intelligenceSnapshots, IntelligenceKind } from "./intelligence-snapshot.service";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { growthIntelligenceService } from "@/domains/growth/services/growth-intelligence.service";

export interface RecomputeSummary {
  tenant_id: string;
  computed_at: string;
  duration_ms: number;
  kinds: Array<{ kind: IntelligenceKind | "lifecycle"; rows: number; duration_ms: number }>;
}

export class IntelligenceRecomputeService {
  /** Recomputes every intelligence kind for one tenant and stores each as one batched, idempotent write. */
  public recomputeAll(tenantId: string): RecomputeSummary {
    const started = Date.now();
    const kinds: RecomputeSummary["kinds"] = [];
    const run = <T extends { id: string; tenant_id: string }>(kind: IntelligenceKind, compute: () => T[]) => {
      const t0 = Date.now();
      const rows = compute();
      intelligenceSnapshots.persist(tenantId, kind, rows);
      kinds.push({ kind, rows: rows.length, duration_ms: Date.now() - t0 });
    };

    run("customers", () => customerIntelligenceService.computeCustomers(tenantId));
    run("products", () => productIntelligenceService.computeProductPerformance(tenantId));
    run("inventory", () => inventoryIntelligenceService.computeInventoryHealth(tenantId));
    run("anomalies", () => anomalyDetectorService.computeAnomalies(tenantId));
    run("opportunities", () => opportunityDetectorService.computeOpportunities(tenantId));
    run("risks", () => riskDetectorService.computeRisks(tenantId));
    run("recommendations", () => recommendationService.computeRecommendations(tenantId));
    run("cohorts", () => cohortAnalysisService.computeCohorts(tenantId));
    run("data_quality", () => [dataQualityService.computeDataQualityReport(tenantId)]);

    // Growth insights read stored lifecycles, so lifecycles are evaluated (and their transitions logged) first.
    const t0 = Date.now();
    const lifecycle = customerLifecycleService.evaluateAllCustomers(tenantId);
    kinds.push({ kind: "lifecycle", rows: lifecycle.totalEvaluated, duration_ms: Date.now() - t0 });
    run("growth_insights", () => growthIntelligenceService.computeGrowthInsights(tenantId));
    run("growth_recommendations", () => growthIntelligenceService.computeGrowthRecommendations(tenantId));

    return { tenant_id: tenantId, computed_at: new Date().toISOString(), duration_ms: Date.now() - started, kinds };
  }
}

export const intelligenceRecomputeService = new IntelligenceRecomputeService();
