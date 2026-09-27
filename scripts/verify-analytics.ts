import { db } from "../src/infrastructure/db";
import { AnalyticsService } from "../src/domains/analytics/analytics.service";
import { RequestContext } from "../src/types";

import { ROLE_PERMISSIONS, PERMISSIONS } from "../src/lib/permissions";

async function verifyAnalytics() {
  console.log("=================================================");
  console.log("   COMMERCEOS ANALYTICS & VOLUME VERIFICATION   ");
  console.log("=================================================\n");

  const tenantId = "ten_default_dhaka";
  const context: RequestContext = {
    tenant: {
      id: tenantId,
      name: "Dhaka Flagship Store",
      domain: "dhaka-flagship.commerceos.bd",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    user: {
      id: "usr_owner_01",
      email: "owner@commerceos.bd",
      role: "ADMIN",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    role: "ADMIN",
    permissions: Object.values(PERMISSIONS) as any[],
    roles: ["ADMIN"],
  };

  // 1. Raw DB stats
  const stats = {
    customers: db.data.customers.filter((c) => c.tenant_id === tenantId).length,
    orders: db.data.orders.filter((o) => o.tenant_id === tenantId).length,
    products: db.data.products.filter((p) => p.tenant_id === tenantId).length,
  };
  console.log("[1] Database Authoritative Record Counts:");
  console.log(`    Customers: ${stats.customers.toLocaleString()}`);
  console.log(`    Orders:    ${stats.orders.toLocaleString()}`);
  console.log(`    Products:  ${stats.products.toLocaleString()}`);

  // 2. Dashboard Metrics
  const dashboardMetrics = db.getDashboardMetrics(tenantId);
  console.log("\n[2] High-Level Dashboard Metrics:");
  console.log(`    Total Orders:     ${dashboardMetrics.totalOrders.toLocaleString()}`);
  console.log(`    Total Revenue:    ৳${dashboardMetrics.totalRevenue.toLocaleString()}`);
  console.log(`    Active Customers: ${dashboardMetrics.activeCustomers.toLocaleString()}`);
  console.log(`    Channel Breakdown:`);
  for (const ch of dashboardMetrics.channelData || []) {
    console.log(`      - ${ch.channel}: ${ch.orders.toLocaleString()} orders (৳${ch.revenueBDT.toLocaleString()}, ${ch.sharePercent}%)`);
  }
  console.log(`    Top City Breakdown:`);
  for (const c of (dashboardMetrics.cityAnalysisData || []).slice(0, 5)) {
    console.log(`      - ${c.city} (${c.division}): ${c.volumePercent}% (${c.orders.toLocaleString()} orders, ৳${c.revenueBDT.toLocaleString()})`);
  }

  // 3. Financial Metrics (30D & ALL)
  const fin30 = await AnalyticsService.getFinancialMetrics(context, "30D");
  const finAll = await AnalyticsService.getFinancialMetrics(context, "ALL");
  console.log("\n[3] Financial Business Intelligence:");
  console.log(`    [Last 30 Days]`);
  console.log(`      Orders Count: ${fin30.total_orders_count.toLocaleString()}`);
  console.log(`      GMV:          ৳${fin30.gmv_bdt.toLocaleString()}`);
  console.log(`      NMV:          ৳${fin30.nmv_bdt.toLocaleString()}`);
  console.log(`      AOV:          ৳${fin30.aov_bdt.toLocaleString()}`);
  console.log(`      Gross Profit: ৳${fin30.gross_profit_bdt.toLocaleString()} (${fin30.gross_margin_pct}%)`);
  console.log(`    [All-Time / 365 Days]`);
  console.log(`      Orders Count: ${finAll.total_orders_count.toLocaleString()}`);
  console.log(`      GMV:          ৳${finAll.gmv_bdt.toLocaleString()}`);
  console.log(`      NMV:          ৳${finAll.nmv_bdt.toLocaleString()}`);
  console.log(`      AOV:          ৳${finAll.aov_bdt.toLocaleString()}`);
  console.log(`      Gross Profit: ৳${finAll.gross_profit_bdt.toLocaleString()} (${finAll.gross_margin_pct}%)`);

  // 4. RTO Geography
  const rto = await AnalyticsService.getRtoGeographyReport(context);
  console.log("\n[4] 64-District RTO & Courier Telemetry:");
  console.log(`    Total Evaluated Shipments: ${rto.total_shipments_evaluated.toLocaleString()}`);
  console.log(`    Overall RTO Rate:          ${rto.overall_rto_rate_pct}%`);
  console.log(`    Inside Dhaka RTO:          ${rto.inside_dhaka_rto_pct}%`);
  console.log(`    Outside Dhaka RTO:         ${rto.outside_dhaka_rto_pct}%`);
  console.log(`    High-Risk Districts:       ${rto.high_risk_districts_count}`);
  console.log(`    Division Summaries:`);
  for (const div of rto.divisions_summary) {
    console.log(`      - ${div.division}: ${div.total_shipments.toLocaleString()} shipments, ${div.rto_rate_pct}% RTO (Highest risk: ${div.highest_risk_district})`);
  }

  // 5. Channel Attribution
  const channels = await AnalyticsService.getChannelAttributionReport(context, "ALL");
  console.log("\n[5] Multi-Channel Attribution:");
  console.log(`    Top Channel by GMV:        ${channels.top_channel_by_gmv}`);
  console.log(`    Top Channel by Conversion: ${channels.top_channel_by_conversion}`);
  for (const c of channels.channels) {
    console.log(`      - ${c.channel_name} (${c.channel}):`);
    console.log(`          Orders: ${c.orders_count.toLocaleString()} (${c.orders_share_pct}%)`);
    console.log(`          GMV:    ৳${c.gmv_bdt.toLocaleString()} (${c.gmv_share_pct}%)`);
    console.log(`          AOV:    ৳${c.aov_bdt.toLocaleString()} | RTO: ${c.rto_rate_pct}% | COD: ${c.cod_share_pct}%`);
  }

  console.log("\n=================================================");
  console.log("   ANALYTICS VERIFICATION COMPLETED SUCCESSFULLY ");
  console.log("=================================================");
}

verifyAnalytics().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
