import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 9: Enterprise Reporting & Export Service
 * Governed executive and domain report generation with CSV and JSON exports.
 */

import { db } from "@/infrastructure/db";
import {
  ReportDefinition,
  ReportExecution,
  EnterpriseUserRecord,
} from "@/types/enterprise";
import { enterpriseAnalyticsService } from "./enterprise-analytics.service";

export class EnterpriseReportingService {
  /**
   * Defines a new scheduled or on-demand enterprise report
   */
  public createReportDefinition(
    orgId: string,
    params: {
      title: string;
      category: ReportDefinition["category"];
      metrics: string[];
      dimensions: string[];
      format?: ReportDefinition["format"];
      schedule?: ReportDefinition["schedule"];
      recipient_emails?: string[];
    }
  ): ReportDefinition {
    const report: ReportDefinition = {
      id: `rep_def_${Date.now()}_${randomSuffix()}`,
      organization_id: orgId,
      title: params.title,
      category: params.category,
      metrics: params.metrics,
      dimensions: params.dimensions,
      entity_scope: { organization_id: orgId, all_access: true },
      format: params.format || "CSV",
      schedule: params.schedule || "WEEKLY",
      recipient_emails: params.recipient_emails ?? [], // no invented recipients (FX-31)
      created_at: new Date().toISOString(),
    };

    return db.createReportDefinition(report);
  }

  /**
   * Executes an enterprise report and produces exported content
   */
  public executeReport(
    orgId: string,
    reportDefId: string,
    caller: EnterpriseUserRecord,
    tenantId: string
  ): { execution: ReportExecution; exportData: string } {
    const analytics = enterpriseAnalyticsService.getConsolidatedAnalytics(orgId, caller, tenantId);

    const summaryMetrics: Record<string, number | string> = {
      total_revenue_bdt: analytics.total_revenue_bdt ?? "not measured",
      total_orders_count: analytics.total_orders_count ?? "not measured",
      blended_aov_bdt: analytics.blended_aov_bdt ?? "not measured",
      reporting_stores_count: analytics.entities.length,
    };

    // Format as CSV
    const csvHeader = "Store ID,Store Name,Revenue (BDT),Orders,AOV (BDT),Delivery SLA %\n";
    const csvRows = analytics.entities
      .map(
        (e) =>
          // Per-store figures aren't measured yet (orders carry no store): empty cells, not invented numbers (FX-30)
          `"${e.entity_id}","${e.entity_name}",${e.revenue_bdt ?? ""},${e.orders_count ?? ""},${e.aov_bdt ?? ""},${e.delivery_sla_pct != null ? `${e.delivery_sla_pct}%` : ""}`
      )
      .join("\n");
    const exportCsv = csvHeader + csvRows;

    const execution: ReportExecution = {
      id: `rep_exec_${Date.now()}_${randomSuffix()}`,
      report_definition_id: reportDefId,
      organization_id: orgId,
      generated_at: new Date().toISOString(),
      status: "COMPLETED",
      records_count: analytics.entities.length,
      download_url: `/api/v1/enterprise/reports/${reportDefId}/download`,
      summary_metrics: summaryMetrics,
    };

    db.createReportExecution(execution);

    return { execution, exportData: exportCsv };
  }
}

export const enterpriseReportingService = new EnterpriseReportingService();
