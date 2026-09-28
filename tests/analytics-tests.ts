// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { analyticsService } from "@/domains/analytics/analytics.service";
import { RequestContext } from "@/lib/context";
import type { Order } from "@/types/commerce";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}

export async function runAnalyticsTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 7: ANALYTICS & BI TEST SUITE      ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_analytics_test_01";

  // Reset and seed database for deterministic test runs
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // Create test context with OWNER role and full permissions
  const testContext: RequestContext = {
    requestId: "req_test_analytics_001",
    traceId: "trace_test_001",
    user: {
      id: "user_analyst_01",
      email: "analyst@example.com",
      name: "Chief Analytics Officer",
      status: "ACTIVE",
    },
    tenant: {
      id: tenantId,
      name: "Analytics Test Commerce",
      slug: "analytics-test",
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: ROLE_PERMISSIONS["OWNER"],
    timestamp: new Date().toISOString(),
  };

  // Seed sample verified orders for the test tenant
  const order1 = db.createOrder(
    {
      id: "ord_test_01",
      tenant_id: tenantId,
      order_number: "ORD-TEST-001",
      customer_id: "cust_test_01",
      status: "DELIVERED",
      currency: "BDT",
      subtotal: 4500,
      discount_total: 300,
      shipping_total: 60,
      tax_total: 0,
      grand_total: 4260,
      payment_method: "BKASH",
      payment_status: "PAID",
      fulfillment_status: "FULFILLED",
      source: "WHATSAPP",
      notes: "WhatsApp conversational checkout",
      shipping_address_snapshot: {
        district: "Dhaka",
        division: "Dhaka",
        zone: "INSIDE_DHAKA",
        address_line_1: "Gulshan 2, Dhaka",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    []
  );

  const order2 = db.createOrder(
    {
      id: "ord_test_02",
      tenant_id: tenantId,
      order_number: "ORD-TEST-002",
      customer_id: "cust_test_02",
      status: "RETURNED",
      currency: "BDT",
      subtotal: 2800,
      discount_total: 0,
      shipping_total: 120,
      tax_total: 0,
      grand_total: 2920,
      payment_method: "COD",
      payment_status: "REFUNDED",
      fulfillment_status: "CANCELLED",
      source: "FACEBOOK",
      notes: "Facebook Messenger checkout - Doorstep refusal",
      shipping_address_snapshot: {
        district: "Cox's Bazar",
        division: "Chattogram",
        zone: "OUTSIDE_DHAKA",
        address_line_1: "Kolatoli Beach Road",
      },
      created_at: new Date(Date.now() - 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    []
  );

  // ==========================================
  // SECTION 1: DETERMINISTIC FINANCIAL METRICS
  // ==========================================
  console.log(`${ANSI_BOLD}--- 1. Deterministic Financial Metrics (Zero-Hallucination) ---${ANSI_RESET}`);

  await runTest("Computes GMV, NMV, AOV, COGS, and Gross Margin with deterministic formulas", async () => {
    const fin = await analyticsService.getFinancialMetrics(testContext, "30D");

    assert.ok(fin.gmv_bdt >= 7180, `Expected GMV >= 7180, got ${fin.gmv_bdt}`);
    assert.ok(fin.nmv_bdt <= fin.gmv_bdt, `Expected NMV <= GMV`);
    assert.ok(fin.aov_bdt > 0, `Expected AOV > 0, got ${fin.aov_bdt}`);
    assert.ok(fin.cogs_bdt > 0, `Expected COGS > 0, got ${fin.cogs_bdt}`);
    assert.ok(fin.gross_profit_bdt > 0, `Expected Gross Profit > 0, got ${fin.gross_profit_bdt}`);
    assert.ok(
      fin.gross_margin_pct >= 0 && fin.gross_margin_pct <= 100,
      `Gross Margin % must be between 0 and 100, got ${fin.gross_margin_pct}`
    );

    // Verify mathematical formula: Gross Profit = GMV - COGS
    const expectedProfit = fin.gmv_bdt - fin.cogs_bdt;
    assert.strictEqual(
      fin.gross_profit_bdt,
      expectedProfit,
      "Authoritative check: Gross Profit must strictly equal GMV - COGS"
    );

    // Verify AOV = GMV / orders_count
    const expectedAov = Math.round(fin.gmv_bdt / fin.total_orders_count);
    assert.strictEqual(fin.aov_bdt, expectedAov, "Authoritative check: AOV must equal GMV / orders_count");
  });

  await runTest("Supports all date presets: TODAY, 7D, 30D, 90D, YTD, ALL", async () => {
    const presets: Array<"TODAY" | "7D" | "30D" | "90D" | "YTD" | "ALL"> = [
      "TODAY",
      "7D",
      "30D",
      "90D",
      "YTD",
      "ALL",
    ];

    for (const preset of presets) {
      const fin = await analyticsService.getFinancialMetrics(testContext, preset);
      assert.ok(typeof fin.gmv_bdt === "number");
      assert.ok(Array.isArray(fin.time_series));
      assert.ok(fin.time_series.length > 0, `Preset ${preset} must generate time series points`);
    }
  });

  await runTest("Generates continuous daily time series data for revenue velocity visualization", async () => {
    const fin = await analyticsService.getFinancialMetrics(testContext, "7D");
    assert.ok(fin.time_series.length >= 7, `Expected at least 7 points for 7D preset, got ${fin.time_series.length}`);

    const samplePt = fin.time_series[0];
    assert.ok(samplePt.date.includes("-"));
    assert.ok(typeof samplePt.gmv_bdt === "number");
    // Buckets are real: GMV adds up to the total, empty buckets are 0 with null AOV/margin (FX-30: no sine-wave filler)
    assert.strictEqual(fin.time_series.reduce((sum, p) => sum + p.gmv_bdt, 0), fin.gmv_bdt);
    for (const pt of fin.time_series) {
      if (pt.orders_count === 0) {
        assert.strictEqual(pt.gmv_bdt, 0);
        assert.strictEqual(pt.aov_bdt, null);
        assert.strictEqual(pt.gross_margin_pct, null);
      } else {
        assert.ok(typeof pt.aov_bdt === "number");
      }
    }
  });

  // ==========================================
  // SECTION 2: 64-DISTRICT RTO GEOGRAPHY
  // ==========================================
  console.log(`\n${ANSI_BOLD}--- 2. 64-District RTO Geography & Division Breakdown ---${ANSI_RESET}`);

  await runTest("Evaluates all 64 districts in Bangladesh without missing any", async () => {
    const report = await analyticsService.getRtoGeographyReport(testContext);

    assert.strictEqual(report.districts.length, 64, `Expected exactly 64 districts in Bangladesh, got ${report.districts.length}`);
    assert.strictEqual(report.divisions_summary.length, 8, `Expected exactly 8 administrative divisions, got ${report.divisions_summary.length}`);

    // Verify presence of major administrative districts
    const districtNames = report.districts.map((d) => d.district);
    assert.ok(districtNames.includes("Dhaka"));
    assert.ok(districtNames.includes("Chattogram"));
    assert.ok(districtNames.includes("Rajshahi"));
    assert.ok(districtNames.includes("Khulna"));
    assert.ok(districtNames.includes("Barishal"));
    assert.ok(districtNames.includes("Sylhet"));
    assert.ok(districtNames.includes("Rangpur"));
    assert.ok(districtNames.includes("Mymensingh"));
    assert.ok(districtNames.includes("Cox's Bazar"));
    assert.ok(districtNames.includes("Sunamganj"));
  });

  await runTest("Correctly classifies Inside Dhaka (৳60) vs Outside Dhaka (৳120) logistics zones", async () => {
    const report = await analyticsService.getRtoGeographyReport(testContext);

    const dhaka = report.districts.find((d) => d.district === "Dhaka");
    assert.ok(dhaka);
    assert.strictEqual(dhaka.zone, "INSIDE_DHAKA");

    const ctg = report.districts.find((d) => d.district === "Chattogram");
    assert.ok(ctg);
    assert.strictEqual(ctg.zone, "OUTSIDE_DHAKA");

    // Two shipments aren't enough for a rate: reported as insufficient data, not invented (FX-30)
    assert.strictEqual(report.inside_dhaka_rto_pct, null);
    assert.strictEqual(report.outside_dhaka_rto_pct, null);
    assert.strictEqual(ctg.risk_tier, "INSUFFICIENT_DATA");
    assert.strictEqual(report.districts.find((d) => d.district === "Cox's Bazar")?.total_shipments, 1);
    assert.strictEqual(report.minimum_shipments_for_rate, 20);
  });

  await runTest("Flags a district as high-risk only from its own shipments (>15% RTO over 20+ shipments)", async () => {
    // 20 shipments to Sunamganj, 5 returned (25%); 20 to Gazipur, none returned.
    const seedShipment = (i: number, district: string, status: "DELIVERED" | "RETURNED") =>
      db.createOrder(
        {
          id: `ord_rto_${district}_${i}`, tenant_id: tenantId, order_number: `RTO-${district}-${i}`, customer_id: "cust_test_01",
          status, currency: "BDT", subtotal: 1000, discount_total: 0, shipping_total: 120, tax_total: 0, grand_total: 1120,
          payment_method: "COD", payment_status: status === "DELIVERED" ? "PAID" : "REFUNDED", fulfillment_status: "FULFILLED",
          source: "WEBSITE", shipping_address_snapshot: { district, division: "Sylhet", address_line_1: "x" },
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        } as Order,
        []
      );
    for (let i = 0; i < 20; i++) seedShipment(i, "Sunamganj", i < 5 ? "RETURNED" : "DELIVERED");
    for (let i = 0; i < 20; i++) seedShipment(i, "Gazipur", "DELIVERED");

    const report = await analyticsService.getRtoGeographyReport(testContext);
    const sunamganj = report.districts.find((d) => d.district === "Sunamganj");
    const gazipur = report.districts.find((d) => d.district === "Gazipur");
    assert.strictEqual(sunamganj?.rto_rate_pct, 25);
    assert.strictEqual(sunamganj?.risk_tier, "HIGH_RISK");
    assert.ok(/advance/i.test(sunamganj!.recommendation));
    assert.strictEqual(gazipur?.rto_rate_pct, 0);
    assert.strictEqual(gazipur?.risk_tier, "LOW");
    assert.strictEqual(sunamganj?.cod_share_pct, 100);
    assert.deepStrictEqual(report.delivery_fees, { inside_dhaka_bdt: 60, outside_dhaka_bdt: 120 }, "fees come from settings/defaults");
  });

  await runTest("Filters 64-district report by division and district search query", async () => {
    // Division filter: Sylhet has 4 districts (Sylhet, Moulvibazar, Habiganj, Sunamganj)
    const sylhetReport = await analyticsService.getRtoGeographyReport(testContext, { division: "Sylhet" });
    assert.strictEqual(sylhetReport.districts.length, 4, `Sylhet division must contain 4 districts, got ${sylhetReport.districts.length}`);

    // Search query: "bogura"
    const searchReport = await analyticsService.getRtoGeographyReport(testContext, { search: "bogura" });
    assert.strictEqual(searchReport.districts.length, 1);
    assert.strictEqual(searchReport.districts[0].district, "Bogura");
  });

  // ==========================================
  // SECTION 3: MULTI-CHANNEL ATTRIBUTION
  // ==========================================
  console.log(`\n${ANSI_BOLD}--- 3. Multi-Channel Revenue & Conversion Attribution ---${ANSI_RESET}`);

  await runTest("Calculates omnichannel attribution across Facebook, WhatsApp, Website, Instagram, and POS", async () => {
    const report = await analyticsService.getChannelAttributionReport(testContext, "30D");

    assert.strictEqual(report.channels.length, 5, `Expected 5 channels, got ${report.channels.length}`);
    assert.ok(report.total_gmv_bdt > 0);
    assert.ok(report.total_orders_count > 0);

    const whatsapp = report.channels.find((c) => c.channel === "WHATSAPP");
    const fb = report.channels.find((c) => c.channel === "FACEBOOK_MESSENGER");
    const web = report.channels.find((c) => c.channel === "WEBSITE");

    assert.ok(whatsapp, "WhatsApp channel must be evaluated");
    assert.ok(fb, "Facebook Messenger channel must be evaluated");
    assert.ok(web, "Website storefront channel must be evaluated");

    // Check sum of GMV shares approximates 100%
    const sumGmvShares = report.channels.reduce((sum, c) => sum + c.gmv_share_pct, 0);
    assert.ok(
      Math.abs(sumGmvShares - 100) < 1.0,
      `Sum of GMV shares must be ~100%, got ${sumGmvShares}%`
    );

    // No visit/session data exists, so conversion is never invented (FX-30: was 18.4% / 9.8% / 3.4% literals)
    assert.ok(report.channels.every((c) => c.conversion_rate_pct === null));
    assert.strictEqual(report.top_channel_by_conversion, null);
    assert.ok(whatsapp.orders_count >= 1 && fb.orders_count >= 1, "real orders are counted in their channels");
  });

  await runTest("A workspace with no orders gets zero totals and no invented change or chart (H7)", async () => {
    const empty = { ...testContext, tenant: { ...testContext.tenant, id: "ten_analytics_empty" } } as RequestContext;
    const channels = await analyticsService.getChannelAttributionReport(empty, "TODAY");
    assert.strictEqual(channels.total_orders_count, 0);
    assert.strictEqual(channels.total_gmv_bdt, 0);
    assert.strictEqual(channels.top_channel_by_gmv, null);
    const fin = await analyticsService.getFinancialMetrics(empty, "TODAY");
    assert.strictEqual(fin.gmv_bdt, 0);
    assert.strictEqual(fin.period_change_pct, null, "no previous window, no change");
    assert.strictEqual(fin.gross_margin_pct, null);
    assert.ok(fin.time_series.every((pt) => pt.gmv_bdt === 0 && pt.orders_count === 0));
    const rto = await analyticsService.getRtoGeographyReport(empty);
    assert.strictEqual(rto.total_shipments_evaluated, 0);
    assert.strictEqual(rto.overall_rto_rate_pct, null);
    assert.strictEqual(rto.high_risk_districts_count, 0);
  });

  await runTest("Period change is computed from the previous window of the same length", async () => {
    const ctx = { ...testContext, tenant: { ...testContext.tenant, id: "ten_analytics_trend" } } as RequestContext;
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const add = (id: string, total: number, daysAgo: number) =>
      db.createOrder(
        {
          id, tenant_id: "ten_analytics_trend", order_number: id, customer_id: "c", status: "DELIVERED", currency: "BDT",
          subtotal: total, discount_total: 0, shipping_total: 0, tax_total: 0, grand_total: total, payment_method: "COD",
          payment_status: "PAID", fulfillment_status: "FULFILLED", source: "WEBSITE", shipping_address_snapshot: {},
          created_at: at(daysAgo), updated_at: at(daysAgo),
        } as Order,
        []
      );
    add("ord_trend_prev", 1000, 10); // previous 7-day window
    add("ord_trend_now", 1500, 2); // current window
    const fin = await analyticsService.getFinancialMetrics(ctx, "7D");
    assert.strictEqual(fin.gmv_bdt, 1500);
    assert.strictEqual(fin.period_change_pct, 50);
  });

  // ==========================================
  // SECTION 4: EXECUTIVE BUSINESS DIGESTS
  // ==========================================
  console.log(`\n${ANSI_BOLD}--- 4. Executive Business Digests & Synthesis Engine ---${ANSI_RESET}`);

  await runTest("Retrieves existing executive digests for the tenant", async () => {
    const digests = await analyticsService.getExecutiveDigests(testContext);
    assert.ok(Array.isArray(digests));
  });

  await runTest("Synthesizes a new Daily Executive Business Digest deterministically", async () => {
    const digest = await analyticsService.generateExecutiveDigest(testContext, {
      period_type: "DAILY",
    });

    assert.ok(digest.id.startsWith("ed_"));
    assert.strictEqual(digest.period_type, "DAILY");
    assert.ok(digest.title.includes("Daily"));
    assert.ok(digest.executive_summary.includes("GMV"));
    assert.strictEqual(digest.generated_by_agent, "ANALYTICS_AGENT");

    // Verify financial summary snapshot
    assert.ok(digest.financial_summary.gmv_bdt > 0);
    assert.ok(digest.financial_summary.aov_bdt > 0);
    assert.ok(digest.financial_summary.gross_margin_pct > 0);

    // Verify strategic recommendations are present
    assert.ok(Array.isArray(digest.strategic_recommendations));
    assert.ok(digest.strategic_recommendations.length >= 2);

    // Verify newly generated digest is persisted in DB
    const fetched = await analyticsService.getExecutiveDigestById(testContext, digest.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.id, digest.id);
  });

  await runTest("Synthesizes a Weekly Executive Digest with 7-day period window", async () => {
    const digest = await analyticsService.generateExecutiveDigest(testContext, {
      period_type: "WEEKLY",
    });

    assert.strictEqual(digest.period_type, "WEEKLY");
    assert.ok(digest.title.includes("Weekly"));

    const start = new Date(digest.period_start).getTime();
    const end = new Date(digest.period_end).getTime();
    const diffDays = Math.round((end - start) / 86400000);
    assert.strictEqual(diffDays, 7, `Expected weekly digest to span 7 days, got ${diffDays}`);
  });

  // ==========================================
  // TEST SUITE SUMMARY
  // ==========================================
  console.log(`\n${ANSI_BOLD}----------------------------------------------------${ANSI_RESET}`);
  console.log(`Tests Passed: ${ANSI_GREEN}${passedCount}${ANSI_RESET} | Tests Failed: ${failedCount === 0 ? ANSI_GREEN : ANSI_RED}${failedCount}${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute test suite
runAnalyticsTests().catch((err) => {
  console.error("Analytics Test Suite Fatal Error:", err);
  process.exit(1);
});
