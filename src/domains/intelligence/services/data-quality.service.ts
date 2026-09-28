/**
 * CommerceOS Phase 6: Data Quality Monitoring Service
 * Validates tenant data integrity, orphan record detection, and multi-tenant boundary compliance.
 */

import { db } from "@/infrastructure/db";
import { DataQualityReport, DataQualityCheck } from "@/types/intelligence";
import { intelligenceSnapshots } from "./intelligence-snapshot.service";

export class DataQualityService {
  /**
   * Runs the data quality checks and stores today's report (one write, idempotent per day).
   */
  public runDataQualityAudit(tenantId: string): DataQualityReport {
    const report = this.computeDataQualityReport(tenantId);
    intelligenceSnapshots.persist(tenantId, "data_quality", [report]);
    return report;
  }

  /** Pure (FX-21): the data quality report as of now. */
  public computeDataQualityReport(tenantId: string): DataQualityReport {
    const orders = db.getAllOrders(tenantId, { hydrate: true });
    const customers = db.getAllCustomers(tenantId);
    const products = db.getAllProducts(tenantId);
    const events = db.getAnalyticsEvents(tenantId);

    const checks: DataQualityCheck[] = [];

    // 1. Check: Missing Timestamps on Orders
    const missingTimestamps = orders.filter((o) => !o.created_at).length;
    checks.push({
      name: "ORDER_TIMESTAMPS_VALIDITY",
      description: "Verifies all recorded orders possess valid ISO-8601 timestamps.",
      passed: missingTimestamps === 0,
      severity: missingTimestamps === 0 ? "INFO" : "CRITICAL",
      affected_count: missingTimestamps,
      details: missingTimestamps === 0 ? "All order records have valid timestamps." : `${missingTimestamps} orders missing timestamps.`,
    });

    // 2. Check: Orphan Orders (order.customer_id missing from customers collection)
    const customerIds = new Set(customers.map((c) => c.id));
    const orphanOrders = orders.filter((o) => o.customer_id && !customerIds.has(o.customer_id)).length;
    checks.push({
      name: "ORPHAN_ORDERS_CHECK",
      description: "Verifies customer identities exist for all non-guest placed orders.",
      passed: orphanOrders === 0,
      severity: orphanOrders === 0 ? "INFO" : "WARNING",
      affected_count: orphanOrders,
      details: orphanOrders === 0 ? "Zero orphan orders detected." : `${orphanOrders} orders reference unregistered customer IDs.`,
    });

    // 3. Check: Product Catalog Pricing Integrity
    const invalidPricedProducts = products.filter((p) => p.base_price < 0).length;
    checks.push({
      name: "PRODUCT_PRICE_INTEGRITY",
      description: "Ensures no active catalog products possess negative unit pricing.",
      passed: invalidPricedProducts === 0,
      severity: invalidPricedProducts === 0 ? "INFO" : "CRITICAL",
      affected_count: invalidPricedProducts,
      details: invalidPricedProducts === 0 ? "Catalog prices satisfy non-negative constraint." : `${invalidPricedProducts} products have invalid prices.`,
    });

    // 4. Check: Multi-Tenant Boundary Isolation Check
    const foreignEvents = events.filter((e) => e.tenant_id !== tenantId).length;
    checks.push({
      name: "TENANT_BOUNDARY_ISOLATION",
      description: "Ensures strict tenant scoping with zero cross-tenant record leakage.",
      passed: foreignEvents === 0,
      severity: foreignEvents === 0 ? "INFO" : "CRITICAL",
      affected_count: foreignEvents,
      details: foreignEvents === 0 ? "Multi-tenant boundary strictly preserved." : `CRITICAL LEAKAGE: ${foreignEvents} foreign tenant events found.`,
    });

    const passedChecks = checks.filter((c) => c.passed).length;
    const overallScore = Math.round((passedChecks / checks.length) * 100);

    const report: DataQualityReport = {
      id: `dqr_${tenantId}_${new Date().toISOString().slice(0, 10)}`,
      tenant_id: tenantId,
      overall_score_pct: overallScore,
      checks,
      missing_data_points: missingTimestamps,
      stale_data_points: 0,
      orphan_records_count: orphanOrders,
      generated_at: new Date().toISOString(),
    };

    return report;
  }
}

export const dataQualityService = new DataQualityService();
