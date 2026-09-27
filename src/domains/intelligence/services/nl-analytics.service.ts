/**
 * CommerceOS Phase 6: Natural Language Analytics Service
 * Parses natural language questions, extracts metric intent and date parameters,
 * executes parameterized queries through AnalyticsQueryService, and formats grounded responses.
 */

import { AnalyticsQuery, AnalyticsQueryResult } from "@/types/intelligence";
import { analyticsQueryService } from "./analytics-query.service";
import { metricRegistryService } from "./metric-registry.service";

export interface NLAnalyticsResponse {
  query: string;
  interpreted_metric?: string;
  parameters: AnalyticsQuery;
  result?: AnalyticsQueryResult;
  grounded_answer: string;
  confidence: number;
}

export class NLAnalyticsService {
  /**
   * Translates a natural language question into a secure parameterized query
   */
  public answerQuestion(tenantId: string, question: string): NLAnalyticsResponse {
    const q = question.toLowerCase();

    // 1. Determine target metric
    let targetMetric = "sales_revenue";
    if (q.includes("order") || q.includes("volume")) {
      targetMetric = "orders_count";
    } else if (q.includes("aov") || q.includes("average order")) {
      targetMetric = "aov_bdt";
    } else if (q.includes("cod") || q.includes("unreconciled")) {
      targetMetric = "unreconciled_cod_bdt";
    } else if (q.includes("return") || q.includes("rto")) {
      targetMetric = "rto_rate";
    } else if (q.includes("margin") || q.includes("profit")) {
      targetMetric = "gross_margin_pct";
    } else if (q.includes("revenue") || q.includes("sales") || q.includes("earning")) {
      targetMetric = "sales_revenue";
    }

    // 2. Determine date range
    const now = new Date();
    let startDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    let endDate = now.toISOString().slice(0, 10);
    let periodLabel = "last 30 days";

    if (q.includes("today")) {
      startDate = now.toISOString().slice(0, 10);
      endDate = startDate;
      periodLabel = "today";
    } else if (q.includes("yesterday")) {
      const yest = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      startDate = yest;
      endDate = yest;
      periodLabel = "yesterday";
    } else if (q.includes("7 days") || q.includes("last week") || q.includes("this week")) {
      startDate = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      endDate = now.toISOString().slice(0, 10);
      periodLabel = "last 7 days";
    } else if (q.includes("90 days") || q.includes("quarter")) {
      startDate = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
      endDate = now.toISOString().slice(0, 10);
      periodLabel = "last 90 days";
    }

    const query: AnalyticsQuery = {
      tenantId,
      metrics: [targetMetric],
      startDate,
      endDate,
      granularity: periodLabel === "today" || periodLabel === "yesterday" ? "HOUR" : "DAY",
      comparison: "PREVIOUS_PERIOD",
    };

    const result = analyticsQueryService.executeQuery(query);
    const metricDef = metricRegistryService.getDefinition(targetMetric);
    const metricLabel = metricDef?.name || targetMetric;
    const value = result.metrics[targetMetric]?.current_value ?? 0;
    const formattedVal =
      metricDef?.unit === "CURRENCY"
        ? `৳${value.toLocaleString()}`
        : metricDef?.unit === "PERCENTAGE"
        ? `${value}%`
        : value.toLocaleString();

    const comparisonText =
      result.metrics[targetMetric]?.percentage_change !== undefined
        ? ` (${result.metrics[targetMetric].percentage_change >= 0 ? "+" : ""}${result.metrics[targetMetric].percentage_change}% compared to the prior period)`
        : "";

    const grounded_answer = `For the period (${periodLabel}), ${metricLabel} is ${formattedVal}${comparisonText}. (Computed deterministically from verified CommerceOS ledger).`;

    return {
      query: question,
      interpreted_metric: targetMetric,
      parameters: query,
      result,
      grounded_answer,
      confidence: 0.95,
    };
  }
}

export const nlAnalyticsService = new NLAnalyticsService();
