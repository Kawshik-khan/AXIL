/**
 * CommerceOS Phase 6: Secure Parameterized Analytics Query Service
 * Deterministic calculation of canonical metrics, comparison periods, and time-series rollups.
 */

import { db } from "@/infrastructure/db";
import {
  AnalyticsQuery,
  AnalyticsQueryResult,
  MetricComparisonResult,
  DateRangePreset,
  ComparisonPeriodType,
} from "@/types/intelligence";
import { metricRegistryService } from "./metric-registry.service";

export class AnalyticsQueryService {
  /**
   * Executes a parameterized, tenant-isolated analytics query
   */
  public executeQuery(query: AnalyticsQuery): AnalyticsQueryResult {
    if (!query.tenantId) {
      throw new Error("Analytics query failed: tenantId is strictly required.");
    }

    // 1. Resolve Date Range
    const { currentRange, comparisonRange } = this.resolveDateRanges(
      query.datePreset || "30D",
      query.startDate,
      query.endDate,
      query.comparison || "PREVIOUS_PERIOD"
    );

    // 2. Fetch authoritative domain records scoped strictly to tenant
    const orders = db.getAllOrders(query.tenantId, { hydrate: true });
    const customers = db.getAllCustomers(query.tenantId);
    const inventory = db.getInventory(query.tenantId);
    const returns = db.getReturns(query.tenantId);

    // 3. Filter records by period
    const currentOrders = orders.filter((o: any) => {
      const t = new Date(o.created_at).getTime();
      return t >= currentRange.start.getTime() && t <= currentRange.end.getTime();
    });

    const compOrders = orders.filter((o: any) => {
      const t = new Date(o.created_at).getTime();
      return t >= comparisonRange.start.getTime() && t <= comparisonRange.end.getTime();
    });

    // 4. Calculate requested metrics
    const metricsResult: Record<string, MetricComparisonResult> = {};
    const requestedMetrics = query.metrics.length > 0 ? query.metrics : [
      "gross_revenue",
      "net_revenue",
      "orders_count",
      "average_order_value",
      "repeat_customer_rate",
      "return_rate",
      "stockout_rate",
    ];

    for (const metricKey of requestedMetrics) {
      // Validate metric is registered
      metricRegistryService.assertValidMetric(metricKey);

      const curVal = this.computeMetricValue(metricKey, currentOrders, customers, inventory, returns);
      const compVal = this.computeMetricValue(metricKey, compOrders, customers, inventory, returns);

      const absChange = Number((curVal - compVal).toFixed(2));
      const pctChange = compVal !== 0 ? Number((((curVal - compVal) / Math.abs(compVal)) * 100).toFixed(2)) : 0;

      let trend: "UP" | "DOWN" | "FLAT" = "FLAT";
      if (pctChange > 0.05) trend = "UP";
      else if (pctChange < -0.05) trend = "DOWN";

      // Determine if increase is favorable
      const isReverseMetric = ["return_rate", "stockout_rate", "cancellation_rate"].includes(metricKey);
      const isFavorable = isReverseMetric ? trend === "DOWN" : trend === "UP";

      metricsResult[metricKey] = {
        metric_key: metricKey,
        current_value: curVal,
        comparison_value: compVal,
        absolute_change: absChange,
        percentage_change: pctChange,
        trend_direction: trend,
        is_favorable: isFavorable,
        period_label: `${currentRange.start.toISOString().slice(0, 10)} to ${currentRange.end.toISOString().slice(0, 10)}`,
        comparison_label: `${comparisonRange.start.toISOString().slice(0, 10)} to ${comparisonRange.end.toISOString().slice(0, 10)}`,
      };
    }

    // 5. Generate Daily Time-Series Points for charts
    const timeSeries = this.generateTimeSeries(currentOrders, currentRange.start, currentRange.end);

    return {
      tenant_id: query.tenantId,
      date_range: {
        start: currentRange.start.toISOString(),
        end: currentRange.end.toISOString(),
        preset: query.datePreset,
      },
      metrics: metricsResult,
      time_series: timeSeries,
      query_version: "1.0.0",
      executed_at: new Date().toISOString(),
    };
  }

  private computeMetricValue(
    key: string,
    orders: Array<any>,
    customers: Array<any>,
    inventory: Array<any>,
    returns: Array<any>
  ): number {
    switch (key) {
      case "sales_revenue":
      case "gross_revenue": {
        const val = orders
          .filter((o) => o.status !== "CANCELLED")
          .reduce((sum, o) => sum + (o.grand_total || (o as any).total_amount || 0), 0);
        return Number(val.toFixed(2));
      }

      case "net_revenue": {
        const val = orders
          .filter((o) => ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(o.status))
          .reduce((sum, o) => sum + (o.grand_total || 0), 0);
        return Number(val.toFixed(2));
      }

      case "orders_count": {
        return orders.filter((o) => o.status !== "CANCELLED").length;
      }

      case "average_order_value": {
        const valid = orders.filter((o) => o.status !== "CANCELLED");
        if (valid.length === 0) return 0;
        const total = valid.reduce((sum, o) => sum + (o.grand_total || 0), 0);
        return Number((total / valid.length).toFixed(2));
      }

      case "repeat_customer_rate": {
        const customerOrderCounts: Record<string, number> = {};
        for (const o of orders) {
          if (o.customer_id) {
            customerOrderCounts[o.customer_id] = (customerOrderCounts[o.customer_id] || 0) + 1;
          }
        }
        const totalCustomers = Object.keys(customerOrderCounts).length;
        if (totalCustomers === 0) return 0;
        const repeatCount = Object.values(customerOrderCounts).filter((c) => c >= 2).length;
        return Number(((repeatCount / totalCustomers) * 100).toFixed(1));
      }

      case "return_rate": {
        const validCount = orders.filter((o) => o.status !== "CANCELLED").length;
        if (validCount === 0) return 0;
        const returnCount = returns.length;
        return Number(((returnCount / validCount) * 100).toFixed(1));
      }

      case "stockout_rate": {
        if (inventory.length === 0) return 0;
        const outOfStock = inventory.filter((i) => i.quantity_available <= 0).length;
        return Number(((outOfStock / inventory.length) * 100).toFixed(1));
      }

      case "conversion_rate": {
        // Conversions default to a healthy baseline if in early data
        const buyingCustomers = new Set(orders.map((o) => o.customer_id)).size;
        const totalProfiles = Math.max(customers.length, buyingCustomers, 1);
        return Number(((buyingCustomers / totalProfiles) * 100).toFixed(1));
      }

      default:
        return 0;
    }
  }

  private resolveDateRanges(
    preset: DateRangePreset,
    customStart?: string,
    customEnd?: string,
    comparison: ComparisonPeriodType = "PREVIOUS_PERIOD"
  ): { currentRange: { start: Date; end: Date }; comparisonRange: { start: Date; end: Date } } {
    const now = new Date();
    let currentStart = new Date();
    let currentEnd = new Date();

    if (preset === "TODAY") {
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (preset === "YESTERDAY") {
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
      currentEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    } else if (preset === "7D") {
      currentStart = new Date(now.getTime() - 7 * 86400000);
    } else if (preset === "14D") {
      currentStart = new Date(now.getTime() - 14 * 86400000);
    } else if (preset === "30D") {
      currentStart = new Date(now.getTime() - 30 * 86400000);
    } else if (preset === "90D") {
      currentStart = new Date(now.getTime() - 90 * 86400000);
    } else if (preset === "THIS_MONTH") {
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    } else if (preset === "PREVIOUS_MONTH") {
      currentStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
      currentEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (preset === "CUSTOM" && customStart && customEnd) {
      currentStart = new Date(customStart);
      currentEnd = new Date(customEnd);
    } else {
      currentStart = new Date(now.getTime() - 30 * 86400000);
    }

    const durationMs = currentEnd.getTime() - currentStart.getTime();
    let compStart = new Date(currentStart.getTime() - durationMs);
    let compEnd = new Date(currentStart.getTime() - 1);

    if (comparison === "PREVIOUS_YEAR") {
      compStart = new Date(currentStart.getFullYear() - 1, currentStart.getMonth(), currentStart.getDate());
      compEnd = new Date(currentEnd.getFullYear() - 1, currentEnd.getMonth(), currentEnd.getDate());
    }

    return {
      currentRange: { start: currentStart, end: currentEnd },
      comparisonRange: { start: compStart, end: compEnd },
    };
  }

  private generateTimeSeries(
    orders: Array<any>,
    start: Date,
    end: Date
  ): Array<{ timestamp: string; metrics: Record<string, number> }> {
    const points: Record<string, { gross_revenue: number; orders_count: number }> = {};
    const curr = new Date(start);

    while (curr <= end) {
      const dateKey = curr.toISOString().slice(0, 10);
      points[dateKey] = { gross_revenue: 0, orders_count: 0 };
      curr.setDate(curr.getDate() + 1);
    }

    for (const o of orders) {
      if (o.status !== "CANCELLED") {
        const d = o.created_at ? o.created_at.slice(0, 10) : "";
        if (points[d]) {
          points[d].gross_revenue += o.grand_total || 0;
          points[d].orders_count += 1;
        }
      }
    }

    return Object.entries(points).map(([date, vals]) => ({
      timestamp: date,
      metrics: {
        gross_revenue: Number(vals.gross_revenue.toFixed(2)),
        orders_count: vals.orders_count,
      },
    }));
  }
}

export const analyticsQueryService = new AnalyticsQueryService();
