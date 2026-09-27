/**
 * CommerceOS Phase 9: Enterprise Workflows Service
 * Orchestrates the 8 canonical enterprise cross-entity operational workflows.
 */

import { db } from "@/infrastructure/db";
import { enterpriseOperationsService } from "./enterprise-operations.service";
import { enterpriseInventoryService } from "./enterprise-inventory.service";
import { enterpriseBenchmarkingService } from "./enterprise-benchmarking.service";
import { dataQualityService } from "./data-quality.service";
import { EnterpriseUserRecord } from "@/types/enterprise";

export class EnterpriseWorkflowsService {
  /**
   * Workflow 1: Enterprise Daily Intelligence
   */
  public async runDailyIntelligenceWorkflow(orgId: string, tenantId: string): Promise<{
    status: "COMPLETED";
    executiveBrief: string;
    totalRevenueBdt: number;
    storesReporting: number;
    incidentsOpen: number;
  }> {
    const overview = enterpriseOperationsService.getOverview(orgId, tenantId);

    const brief = `Enterprise Intelligence Brief for ${overview.organization.name}: ` +
      `Consolidated revenue stands at BDT ${overview.summary_metrics.consolidated_revenue_bdt.toLocaleString()} across ` +
      `${overview.summary_metrics.total_stores} stores. Blended gross margin is ${overview.summary_metrics.blended_gross_margin_pct}%. ` +
      `${overview.summary_metrics.active_incidents_count} open incidents require operational triage.`;

    return {
      status: "COMPLETED",
      executiveBrief: brief,
      totalRevenueBdt: overview.summary_metrics.consolidated_revenue_bdt,
      storesReporting: overview.summary_metrics.total_stores,
      incidentsOpen: overview.summary_metrics.active_incidents_count,
    };
  }

  /**
   * Workflow 2: Cross-Store Inventory Balancing
   */
  public async runInventoryBalancingWorkflow(orgId: string, tenantId: string): Promise<{
    status: "PROPOSED" | "NO_ACTION_NEEDED";
    proposalsCount: number;
    proposals: Array<{ sku: string; from: string; to: string; qty: number }>;
  }> {
    const rawProposals = enterpriseInventoryService.proposeNetworkBalancing(orgId, tenantId);

    return {
      status: rawProposals.length > 0 ? "PROPOSED" : "NO_ACTION_NEEDED",
      proposalsCount: rawProposals.length,
      proposals: rawProposals.map((p) => ({
        sku: p.sku,
        from: p.source_store_name,
        to: p.target_store_name,
        qty: p.recommended_transfer_qty,
      })),
    };
  }

  /**
   * Workflow 6: Enterprise Benchmarking
   */
  public async runBenchmarkingWorkflow(
    orgId: string,
    metricKey: string,
    caller: EnterpriseUserRecord,
    tenantId: string
  ): Promise<{
    status: "COMPLETED";
    benchmarkTitle: string;
    cohortAverage: number;
    leaderEntity: string;
  }> {
    const benchmark = enterpriseBenchmarkingService.generateStoreBenchmark(orgId, metricKey, caller, tenantId);
    const leader = benchmark.items.length > 0 ? benchmark.items[0].entity_name : "N/A";

    return {
      status: "COMPLETED",
      benchmarkTitle: benchmark.title,
      cohortAverage: benchmark.cohort_average,
      leaderEntity: leader,
    };
  }

  /**
   * Workflow 7: Enterprise Data Quality
   */
  public async runDataQualityWorkflow(orgId: string, tenantId: string): Promise<{
    status: "COMPLETED";
    issuesDetected: number;
    criticalIssuesCount: number;
  }> {
    const issues = dataQualityService.runQualityAudit(orgId, tenantId);
    const critical = issues.filter((i) => i.severity === "CRITICAL").length;

    return {
      status: "COMPLETED",
      issuesDetected: issues.length,
      criticalIssuesCount: critical,
    };
  }

  /**
   * Workflow 8: Enterprise Security Review
   */
  public async runSecurityReviewWorkflow(orgId: string, tenantId: string): Promise<{
    status: "COMPLETED";
    auditEntriesScanned: number;
    anomalousEventsCount: number;
    securityHealthScore: number;
  }> {
    const auditLogs = db.getAuditLogsByTenant(tenantId).logs;
    const suspiciousActions = auditLogs.filter((a) => a.action.includes("FAILED") || a.action.includes("REVOKED"));

    return {
      status: "COMPLETED",
      auditEntriesScanned: auditLogs.length,
      anomalousEventsCount: suspiciousActions.length,
      securityHealthScore: suspiciousActions.length === 0 ? 100 : 85,
    };
  }
}

export const enterpriseWorkflowsService = new EnterpriseWorkflowsService();
