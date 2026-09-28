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
   * The report's CSV for the caller's scope. Pure: nothing is stored (used by the download GET).
   */
  public buildReportCsv(orgId: string, caller: EnterpriseUserRecord, tenantId: string): { csv: string; rows: number } {
    const analytics = enterpriseAnalyticsService.getConsolidatedAnalytics(orgId, caller, tenantId);
    // Quote every cell and neutralise spreadsheet formulas (a store named "=HYPERLINK(...)" would run in Excel)
    const cell = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const text = String(v);
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = ["Store ID", "Store Name", "Revenue (BDT)", "Orders", "AOV (BDT)", "Delivery SLA %"].map(cell).join(",");
    // Per-store figures aren't measured yet (orders carry no store): empty cells, not invented numbers (FX-30)
    const rows = analytics.entities.map((e) =>
      [e.entity_id, e.entity_name, e.revenue_bdt, e.orders_count, e.aov_bdt, e.delivery_sla_pct].map(cell).join(",")
    );
    return { csv: [header, ...rows].join("\n"), rows: rows.length };
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

    const exportCsv = this.buildReportCsv(orgId, caller, tenantId).csv;

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
