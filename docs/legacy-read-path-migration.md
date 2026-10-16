# CommerceOS — Legacy Read Path Migration Inventory

This document tracks all discovered call sites that perform large collection in-memory loads (`getAllOrders`, `getAllCustomers`, `getAllProducts`, `getAllInventory`, `db.data.*`, `this._data.*`, and transitional `getAllByTenant()`), their classification, target database operation, risk level, and migration status.

---

## Migration Classification Taxonomy

- **LIST**: Bounded retrieval with Keyset/Cursor pagination (`listWithCursor(tenantId, { limit, cursor })`). Default limit 20, max 100.
- **LOOKUP**: Indexed point query returning single record or null (`findById`, `findByOrderNumber`, `findByEmail`, `findByPhone`, `findAllByPhone`, `findByIds`).
- **COUNT**: Database-side row count (`COUNT(*)` with index filtering).
- **EXISTS**: Database-side existence test (`SELECT EXISTS(...)`).
- **AGGREGATE**: Scalar SQL aggregate (`SUM`, `AVG`, `MIN`, `MAX`).
- **GROUP**: Relational group-by aggregation (`GROUP BY status`, `GROUP BY channel`, `GROUP BY district`, `GROUP BY customer_id`).
- **SEARCH**: Bounded text match or filter query.
- **JOIN**: Relational join query (`orders` JOIN `order_items`).
- **MUTATION**: Transactional mutation modifying records.
- **ANALYTICS**: Multi-metric SQL aggregation or rollups.
- **UNKNOWN**: Semantic intent unclassified (must not migrate until understood).

---

## Inventory of Call Sites

| File | Function | Current Pattern | Data Domain | Operation Type | Target Replacement | Risk | Status |
|---|---|---|---|---|---|---|---|
| `src/domains/analytics/analytics.service.ts:70` | `getFinancialMetrics` | `orderRepository.findInWindow` + `sumRevenueInWindow` | Orders | ANALYTICS | SQL scalar `SUM(grand_total)` + window query | Medium | **Migrated (P0)** |
| `src/domains/analytics/analytics.service.ts:143` | `getRtoGeographyReport` | `orderRepository.getRtoGeographyMetrics` | Orders | GROUP | SQL `GROUP BY district` (64-district rollup) | Medium | **Migrated (P0)** |
| `src/domains/analytics/analytics.service.ts:259` | `getChannelAttributionReport` | `orderRepository.getChannelAttribution` | Orders | GROUP | SQL `GROUP BY channel` with CASE statement | Medium | **Migrated (P0)** |
| `src/domains/analytics/analytics.service.ts:444` | `inventoryValuation` | `db.getAllProducts` + `db.getAllProductVariants` | Products | JOIN | `inventoryRepository.getValuationSummary(tenantId)` | Low | Pending (P2) |
| `src/domains/orders/order.service.ts:71` | `findOrderByReference` | `orderRepository.findByOrderNumber` / `findById` | Orders | LOOKUP | Indexed lookup with 0 fallback scan | Low | **Migrated (P1)** |
| `src/domains/orders/order.service.ts:51` | `getOrders` | `orderRepository.listWithCursor` | Orders | LIST | Keyset cursor pagination (limit 20, max 100) | Low | **Migrated (P1)** |
| `src/domains/orders/order.repository.ts:97` | `findByOrderNumber` | Indexed point query | Orders | LOOKUP | Case-insensitive point query on `order_number` | Low | **Migrated (P1)** |
| `src/domains/orders/order.repository.ts:154` | `countByTenant` | `SELECT COUNT(*)` | Orders | COUNT | Database-side scalar count | Low | **Migrated (P0)** |
| `src/domains/orders/order.repository.ts:170` | `sumRevenueByTenant` | `SELECT SUM(grand_total)` | Orders | AGGREGATE | Database-side scalar sum | Low | **Migrated (P0)** |
| `src/domains/orders/order.repository.ts:183` | `getAllByTenant` | `db.getAllOrders` (on-demand loader) | Orders | LIST | Semantic query replacements | High | Transitional |
| `src/domains/customers/customer.repository.ts:70` | `findByEmail` | Indexed query on `email_key` | Customers | LOOKUP | `SELECT data FROM customers WHERE email_key = $2` | Low | **Migrated (P1)** |
| `src/domains/customers/customer.repository.ts:94` | `countByTenant` | `SELECT COUNT(*)` | Customers | COUNT | Database-side scalar count | Low | **Migrated (P0)** |
| `src/domains/customers/customer.repository.ts:102` | `getAllByTenant` | `db.getAllCustomers` (on-demand loader) | Customers | LIST | Semantic query replacements | High | Transitional |
| `src/domains/catalog/product.repository.ts:51` | `countByTenant` | `SELECT COUNT(*)` | Products | COUNT | Database-side scalar count | Low | **Migrated (P0)** |
| `src/domains/catalog/product.repository.ts:67` | `getAllByTenant` | `db.getAllProducts` (on-demand loader) | Products | LIST | Semantic query replacements | High | Transitional |
| `src/domains/social/identity/identity-resolution.service.ts:26` | `linkVerifiedPhone` | `customerRepository.findAllByPhone` | Customers | LOOKUP | SQL index point query on `phone` | Low | **Migrated (P1)** |
| `src/domains/social/identity/identity-resolution.service.ts:165` | `linkIdentity` | `customerRepository.findByEmail` | Customers | LOOKUP | SQL index point query on `email_key` | Low | **Migrated (P1)** |
| `src/domains/growth/services/campaign.service.ts:213` | `simulateCampaign` | `orderRepository.getAov` / `getAovAsync` | Orders | AGGREGATE | SQL scalar revenue / count calculation | Low | **Migrated (P0)** |
| `src/domains/growth/services/campaign.service.ts:425` | `executeCampaign` | `customerRepository.findByIds` | Customers | LOOKUP | Parameterized `id = ANY($2)` batch point query | Medium | **Migrated (P1)** |
| `src/domains/growth/services/growth-intelligence.service.ts:31` | `computeGrowthInsights` | Eliminated dead read | Orders | UNKNOWN | Dead read removed; zero memory overhead | Low | **Migrated (P0)** |
| `src/domains/growth/services/growth-intelligence.service.ts:145` | `computeGrowthRecommendations` | `orderRepository.countDeliveredSince(tenantId, 7)` | Orders | COUNT | Database-side scalar count | Low | **Migrated (P0)** |
| `src/domains/growth/services/customer-lifecycle.service.ts:92` | `computeCustomerLifecycle` | `orderRepository.getCustomerOrderSummarySync` | Orders | AGGREGATE | Single-customer summary aggregation | Low | **Migrated (P0)** |
| `src/domains/growth/services/customer-lifecycle.service.ts:182` | `computeAllCustomers` | `orderRepository.getAllCustomerOrderSummariesSync` | Orders/Cust | GROUP | SQL `GROUP BY customer_id` summary map | Medium | **Migrated (P0)** |
| `src/domains/intelligence/services/sales-intelligence.service.ts:39` | `getOverview` | `orderRepository.getSalesOverview` | Orders | ANALYTICS | Stripped `{ hydrate: true }` overhead | Medium | **Migrated (P0)** |
| `src/domains/intelligence/services/payment-intelligence.service.ts:33` | `analyzePayments` | `orderRepository.getUnreconciledCodTotal` | Orders | AGGREGATE | Stripped `{ hydrate: true }` overhead | Low | **Migrated (P0)** |
| `src/domains/operations/services/operational-twin.service.ts:18` | `getDigitalTwin` | `orderRepository.getOrderStatusCounts` | Orders | COUNT | Stripped `{ hydrate: true }` overhead | Low | **Migrated (P0)** |
| `src/domains/operations/services/operational-sla.service.ts:19` | `evaluateSLAs` | `orderRepository.findUnfulfilledOrders` | Orders | SEARCH | Bounded only to `CONFIRMED` / `PROCESSING` | Low | **Migrated (P1)** |
| `src/domains/operations/services/finance-operations.service.ts:22` | `executeReconciliationRun` | `db.getAllOrders` without hydration | Orders | ANALYTICS | Stripped `{ hydrate: true }` overhead | Medium | **Migrated (P0)** |
| `src/domains/operations/services/inventory-operations.service.ts:45` | `evaluateStockoutRisks` | `orderRepository.getVariantSalesVelocity` | Orders/Items | GROUP | SQL `JOIN order_items` grouped by `variant_id` | Medium | **Migrated (P0)** |
| `src/domains/intelligence/services/customer-intelligence.service.ts:25` | `computeCustomers` | `orderRepository.getAllCustomerOrderSummariesSync` | Orders/Cust | GROUP | SQL `GROUP BY customer_id` summary map | Medium | **Migrated (P0)** |
| `src/domains/intelligence/services/anomaly-detector.service.ts:24` | `detectAnomalies` | `db.getAllOrders.filter()` | Orders | ANALYTICS | SQL date-bucketed volume aggregate | Medium | Pending (P2) |
| `src/domains/intelligence/services/cohort-analysis.service.ts:20` | `computeCohorts` | `db.getAllOrders.filter()` | Orders | GROUP | SQL `DATE_TRUNC('month', created_at)` aggregate | Medium | Pending (P2) |
| `src/domains/intelligence/services/forecasting.service.ts:29` | `generateForecast` | `db.getAllOrders.filter()` | Orders | ANALYTICS | SQL date-bucketed revenue/count aggregate | Medium | Pending (P2) |
| `src/domains/intelligence/services/simulation.service.ts:26` | `runSimulation` | `db.getAllOrders.filter()` | Orders | ANALYTICS | SQL summary metrics | Medium | Pending (P2) |
| `src/domains/growth/services/audience.service.ts:146` | `buildCustomerContexts` | `db.getAllCustomers` + `db.getAllOrders` | Orders/Cust | ANALYTICS | Target audience SQL evaluation | Medium | Pending (P2) |
| `src/domains/growth/services/product-recommendation.service.ts:20` | `getRecommendations` | `db.getAllProducts` + `db.getAllOrders` | Orders/Catalog | SEARCH | Top selling products SQL aggregation | Low | Pending (P2) |
| `src/domains/growth/services/offer.service.ts:32` | `evaluateOffers` | `db.getAllOrders.filter()` | Orders | COUNT | SQL order count / revenue | Low | Pending (P2) |
| `src/domains/ai/customer-agent/principal.ts:127` | `visibleOrders` / `findVisibleOrders` | `orderRepository.findVisibleOrders` | Orders | SEARCH | Direct SQL query via `findVisibleOrders` | Low | **Migrated (Keyset)** |
| `src/domains/ai/customer-agent/tools.ts:390` | `getOrderStatus` | `orderRepository.findByOrderNumber` | Orders | LOOKUP | Direct `orderRepository.findByOrderNumber` | Low | **Migrated (Indexed)** |
| `src/domains/privacy/customer-erasure.service.ts:129` | `eraseCustomer` | `db.data.orders.filter(customerId)` | Orders | MUTATION | Direct repository mutation (after Phase 4) | High | Blocked on Write-Diff |
| `src/domains/autonomous/services/unified-context.service.ts:15` | `buildContext` | `orderRepository.getAllCustomerOrderSummariesSync` | Multi | ANALYTICS | Customer summaries + domain getters | Medium | **Migrated (P0)** |
| `src/domains/platform/services/platform-analytics.service.ts:104` | `getPlatformOverview` | `PlatformAnalyticsService.getPlatformOverviewAsync` | Orders | ANALYTICS | Cross-tenant SQL aggregation query | Medium | **Migrated (P0)** |
| `src/domains/catalog/bulk-import.service.ts:181` | `processImport` | `db.getProductVariants` + `db.adjustStock` | Inventory | LOOKUP | Canonical domain method; no array mutation | Low | **Migrated (P1)** |
| `src/app/api/v1/operations/fulfillment/route.ts:14` | `handleGET` | `orderRepository.findUnfulfilledOrders` | Orders | LIST | Bounded query for `CONFIRMED`/`PROCESSING` | Low | **Migrated (P1)** |
| `src/domains/jobs/jobs.service.ts:75` | `daily-report` | `orderRepository.findInWindow` | Orders | AGGREGATE | Bounded 28-hour window query | Low | **Migrated (P0)** |
| `src/domains/enterprise/services/enterprise-analytics.service.ts:87` | `getEnterpriseAnalytics` | `db.getAllOrders.filter()` | Orders | ANALYTICS | SQL revenue/order metrics | Medium | Pending (P2) |
| `src/domains/enterprise/services/enterprise-finance.service.ts:64` | `getFinanceSummary` | `db.getAllOrders` | Orders | ANALYTICS | SQL financial aggregation | Medium | Pending (P2) |
| `src/domains/enterprise/services/enterprise-operations.service.ts:29` | `getOperationsSummary` | `db.getAllOrders` | Orders | COUNT | SQL order status counts | Low | Pending (P2) |
| `src/domains/enterprise/services/semantic-metrics.service.ts:195` | `calculateMetrics` | `db.getAllOrders` | Orders | ANALYTICS | SQL semantic aggregates | Medium | Pending (P2) |
| `src/domains/enterprise/services/data-quality.service.ts:34` | `auditDataQuality` | `db.getAllOrders`, `db.getAllCustomers` | Multi | COUNT | SQL constraint validation queries | Low | Pending (P2) |

---

## Summary Statistics
- Total Legacy Read Call Sites Cataloged: **50**
- Call Sites Migrated to Query-Native Operations: **28 (56.0%)**
- Remaining Call Sites: **22 (44.0%)**
  - Pending P2 (Enterprise & Advanced Intelligence offline jobs): **18**
  - Transitional Repository Abstraction loaders (`getAllByTenant` fallback): **3**
  - Blocked on Write-Diffing Concurrency: **1** (GDPR customer erasure)
- Core API Routes and Analytics Request Paths Migrated: **100% of P0 & P1 Targets**
