// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { enterpriseDataAccessService } from "@/domains/enterprise/services/enterprise-data-access.service";
import { enterpriseRbacService } from "@/domains/enterprise/services/enterprise-rbac.service";
import { semanticMetricsService } from "@/domains/enterprise/services/semantic-metrics.service";
import { enterpriseBenchmarkingService } from "@/domains/enterprise/services/enterprise-benchmarking.service";
import { enterpriseReportingService } from "@/domains/enterprise/services/enterprise-reporting.service";
import { integrationHubService, toPublicInstallation } from "@/domains/enterprise/services/integration-hub.service";
import { developerPlatformService } from "@/domains/enterprise/services/developer-platform.service";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { dataGovernanceService } from "@/domains/enterprise/services/data-governance.service";
import { dataQualityService } from "@/domains/enterprise/services/data-quality.service";
import { enterpriseCustomerIdentityService } from "@/domains/enterprise/services/enterprise-customer-identity.service";
import { enterprisePricingService } from "@/domains/enterprise/services/enterprise-pricing.service";
import { enterpriseIncidentService } from "@/domains/enterprise/services/enterprise-incident.service";
import { syncEngineService } from "@/domains/enterprise/services/sync-engine.service";
import { conflictResolutionService } from "@/domains/enterprise/services/conflict-resolution.service";
import { enterpriseSupervisorAgent } from "@/domains/enterprise/agents/enterprise-supervisor.agent";
import { toolRegistry } from "@/domains/ai/tools/tool-registry";
import { agentRegistry } from "@/domains/ai/orchestration/agent-registry";
import { EnterpriseUserRecord } from "@/types/enterprise";
import { PERMISSIONS } from "@/lib/permissions";

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

export async function runEnterpriseTests() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 9: ENTERPRISE INTELLIGENCE & ECOSYSTEM SUITE ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_enterprise_test";
  const orgId = "org_apex_holdings";

  // Reset database state for deterministic test run
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // -------------------------------------------------------------
  // 1. Multi-Entity Hierarchy Tree & Scoping
  // -------------------------------------------------------------
  await runTest("1.1 Hierarchy Service: Create Organization, Business Unit, Brand, and Stores", () => {
    const org = enterpriseHierarchyService.createOrganization({
      id: orgId,
      name: "Apex Holdings Enterprise",
      slug: "apex-holdings",
      legal_name: "Apex Holdings Bangladesh Ltd.",
      tax_identifier: "BIN-992384110",
      default_currency: "BDT",
      supported_currencies: ["BDT", "USD"],
      headquarters_country: "Bangladesh",
    });
    assert.strictEqual(org.id, orgId);
    assert.strictEqual(org.status, "ACTIVE");

    const buRetail = enterpriseHierarchyService.createBusinessUnit(orgId, {
      id: "bu_retail",
      name: "Fashion & Retail BU",
      code: "FRBU",
      description: "Direct-to-consumer apparel and accessories",
      budget_allocated_bdt: 5000000,
    });
    assert.strictEqual(buRetail.organization_id, orgId);

    const brandA = enterpriseHierarchyService.createBrand(orgId, {
      id: "br_urban_stitch",
      business_unit_id: "bu_retail",
      name: "Urban Stitch",
      slug: "urban-stitch",
      primary_category: "Apparel",
      currency: "BDT",
    });
    assert.strictEqual(brandA.business_unit_id, "bu_retail");

    const storeDhaka = enterpriseHierarchyService.createStore(orgId, {
      id: "str_dhk_flagship",
      business_unit_id: "bu_retail",
      brand_id: "br_urban_stitch",
      name: "Urban Stitch - Dhaka Flagship",
      code: "US-DHK",
      store_type: "PHYSICAL_OUTLET",
      region: "Dhaka",
      city: "Dhaka",
      currency: "BDT",
    });

    const storeOnline = enterpriseHierarchyService.createStore(orgId, {
      id: "str_us_online",
      business_unit_id: "bu_retail",
      brand_id: "br_urban_stitch",
      name: "Urban Stitch - Online Store",
      code: "US-ONL",
      store_type: "ONLINE_STORE",
      region: "Nationwide",
      city: "Dhaka",
      currency: "BDT",
    });

    assert.strictEqual(storeDhaka.brand_id, "br_urban_stitch");
    assert.strictEqual(storeOnline.store_type, "ONLINE_STORE");

    const tree = enterpriseHierarchyService.buildHierarchyTree(orgId);
    assert.strictEqual(tree.organization.id, orgId);
    assert.strictEqual(tree.business_units.length, 1);
    assert.strictEqual(tree.business_units[0].standalone_brands.length, 1);
    assert.strictEqual(tree.business_units[0].standalone_brands[0].stores.length, 2);
  });

  // -------------------------------------------------------------
  // 2. Cross-Store Data Access Isolation & Scoping
  // -------------------------------------------------------------
  await runTest("2.1 Data Access Scoping: Admin vs Single-Store Scoped User", () => {
    const adminUser: EnterpriseUserRecord = {
      id: "usr_org_admin",
      organization_id: orgId,
      user_id: "usr_org_admin",
      name: "Org Superadmin",
      email: "superadmin@apex.com",
      enterprise_role: "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: orgId, all_access: true },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const storeUser: EnterpriseUserRecord = {
      id: "usr_store_mgr",
      organization_id: orgId,
      user_id: "usr_store_mgr",
      name: "Dhaka Store Manager",
      email: "mgr.dhaka@apex.com",
      enterprise_role: "STORE_MANAGER",
      assigned_scope: { organization_id: orgId, store_ids: ["str_dhk_flagship"] },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const adminStores = enterpriseDataAccessService.getAuthorizedStores(adminUser);
    assert.strictEqual(adminStores.length, 2, "Admin should see both stores");

    const storeUserStores = enterpriseDataAccessService.getAuthorizedStores(storeUser);
    assert.strictEqual(storeUserStores.length, 1, "Store user should only see Dhaka flagship");
    assert.strictEqual(storeUserStores[0].id, "str_dhk_flagship");

    assert.strictEqual(enterpriseDataAccessService.canAccessStore(storeUser, "str_dhk_flagship"), true);
    assert.strictEqual(enterpriseDataAccessService.canAccessStore(storeUser, "str_us_online"), false);
  });

  // -------------------------------------------------------------
  // 3. Enterprise RBAC Inheritance & Role Assertions
  // -------------------------------------------------------------
  await runTest("3.1 RBAC Service: Role Permission Checking and Scope Assertions", () => {
    const adminUser: EnterpriseUserRecord = {
      id: "usr_org_admin",
      organization_id: orgId,
      user_id: "usr_org_admin",
      name: "Org Superadmin",
      email: "superadmin@apex.com",
      enterprise_role: "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: orgId, all_access: true },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const devUser: EnterpriseUserRecord = {
      id: "usr_dev_engineer",
      organization_id: orgId,
      user_id: "usr_dev_engineer",
      name: "API Developer",
      email: "dev@apex.com",
      enterprise_role: "DEVELOPER",
      assigned_scope: { organization_id: orgId },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    assert.strictEqual(enterpriseRbacService.hasPermission(adminUser, PERMISSIONS.ORGANIZATION_MANAGE), true);
    assert.strictEqual(enterpriseRbacService.hasPermission(adminUser, PERMISSIONS.DEVELOPER_MANAGE), true);

    assert.strictEqual(enterpriseRbacService.hasPermission(devUser, PERMISSIONS.DEVELOPER_MANAGE), true);
    assert.strictEqual(enterpriseRbacService.hasPermission(devUser, PERMISSIONS.ORGANIZATION_MANAGE), false);

    // Permission assertion test
    assert.doesNotThrow(() => {
      enterpriseRbacService.assertPermission(adminUser, PERMISSIONS.ORGANIZATION_MANAGE);
    });
    assert.throws(() => {
      enterpriseRbacService.assertPermission(devUser, PERMISSIONS.ORGANIZATION_MANAGE);
    }, /Forbidden/);
  });

  // -------------------------------------------------------------
  // 4. Semantic Metrics Layer
  // -------------------------------------------------------------
  await runTest("4.1 Semantic Metrics Service: Seed Standard Metrics & Evaluate KPIs", () => {
    const standardMetrics = semanticMetricsService.seedStandardMetrics(orgId);
    assert(standardMetrics.length >= 4, "Should seed at least 4 standard metrics");

    // Evaluate gross revenue metric
    const result = semanticMetricsService.evaluateMetric(orgId, {
      metric_key: "gross_revenue",
    }, tenantId);

    assert.strictEqual(result.metric_key, "gross_revenue");
    assert.strictEqual(result.unit, "BDT");
    assert.strictEqual(result.data_quality_status, "VERIFIED");
    assert(typeof result.value === "number");

    // Evaluate delivery SLA metric
    const slaResult = semanticMetricsService.evaluateMetric(orgId, {
      metric_key: "delivery_sla_pct",
    }, tenantId);
    assert.strictEqual(slaResult.metric_key, "delivery_sla_pct");
    assert.strictEqual(slaResult.unit, "PERCENT");
  });

  // -------------------------------------------------------------
  // 5. Cross-Store & Brand Benchmarking
  // -------------------------------------------------------------
  await runTest("5.1 Benchmarking Service: Store & Brand Cohort Percentile Rankings", () => {
    const adminUser: EnterpriseUserRecord = {
      id: "usr_org_admin",
      organization_id: orgId,
      user_id: "usr_org_admin",
      name: "Org Superadmin",
      email: "superadmin@apex.com",
      enterprise_role: "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: orgId, all_access: true },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const benchmark = enterpriseBenchmarkingService.generateStoreBenchmark(
      orgId,
      "gross_revenue",
      adminUser,
      tenantId
    );

    assert.strictEqual(benchmark.organization_id, orgId);
    assert.strictEqual(benchmark.benchmark_type, "STORE_VS_STORE");
    assert.strictEqual(benchmark.items.length, 2);
    // Orders carry no store: the stores in scope are listed, with no invented values or ranks (FX-30)
    assert.strictEqual(benchmark.data_status, "NOT_MEASURED");
    assert.ok(benchmark.items.every((i) => i.value === null && i.rank === null && i.percentile === null));
    assert.strictEqual(benchmark.cohort_average, null);
    assert.strictEqual(benchmark.cohort_median, null);
    assert.strictEqual(benchmark.is_statistically_significant, false);

    const brandBench = enterpriseBenchmarkingService.generateBrandBenchmark(
      orgId,
      "gross_revenue",
      adminUser
    );
    assert.strictEqual(brandBench.benchmark_type, "BRAND_VS_BRAND");
    assert.strictEqual(brandBench.items.length, 1);
  });

  // -------------------------------------------------------------
  // 6. Enterprise Reporting Engine
  // -------------------------------------------------------------
  await runTest("6.1 Reporting Engine: Create Definition & Generate CSV Export", () => {
    const adminUser: EnterpriseUserRecord = {
      id: "usr_org_admin",
      organization_id: orgId,
      user_id: "usr_org_admin",
      name: "Org Superadmin",
      email: "superadmin@apex.com",
      enterprise_role: "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: orgId, all_access: true },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const def = enterpriseReportingService.createReportDefinition(orgId, {
      title: "Monthly Store Revenue Summary",
      category: "EXECUTIVE",
      metrics: ["gross_revenue", "average_order_value"],
      dimensions: ["STORE"],
      format: "CSV",
      schedule: "ON_DEMAND",
    });

    const executionResult = enterpriseReportingService.executeReport(
      orgId,
      def.id,
      adminUser,
      tenantId
    );

    assert.strictEqual(executionResult.execution.status, "COMPLETED");
    assert(executionResult.execution.records_count >= 2);
    assert(typeof executionResult.exportData === "string");
    assert(executionResult.exportData.includes(`"Store ID","Store Name"`)); // every cell quoted (FX-33)
  });

  // -------------------------------------------------------------
  // 7. Integration Hub, Sync Execution & Conflict Resolution
  // -------------------------------------------------------------
  await runTest("7.1 Integration Hub: Install Adapters, Execute Sync & Resolve Conflicts", async () => {
    const installed = integrationHubService.installIntegration(orgId, {
      providerId: "prov_sap_s4hana",
      credentials: { api_key: "sap_test_secret_123" },
      syncFrequencyMinutes: 30,
    });

    assert.strictEqual(installed.provider_id, "prov_sap_s4hana");
    // Saved, never checked with SAP; credentials encrypted, not base64 (FX-31)
    assert.strictEqual(installed.status, "NOT_VERIFIED");
    assert.strictEqual(installed.last_sync_at, undefined);
    assert.ok(!Buffer.from(installed.credentials_encrypted, "base64").toString("utf8").includes("sap_test_secret_123"));
    assert.ok(!("credentials_encrypted" in toPublicInstallation(installed)));
    await assert.rejects(
      async () => integrationHubService.triggerProviderSync(orgId, installed.id),
      (err: Error & { code?: string }) => err.code === "INTEGRATION_NOT_CONFIGURED",
    );

    const syncRecord = await syncEngineService.executeSync({
      organizationId: orgId,
      integrationId: installed.id,
      entityType: "ORDERS",
      items: [{ order_id: "ord_ext_1", total: 5000 }],
      processItemFn: async () => ({ success: true }),
    });
    assert.strictEqual(syncRecord.status, "COMPLETED");
    assert.strictEqual(syncRecord.entity_type, "ORDERS");
    // Processing local items doesn't prove the provider connection
    assert.strictEqual(db.getIntegrationInstallations(orgId).find((i) => i.id === installed.id)?.status, "NOT_VERIFIED");

    // Conflict detection and resolution
    const conflictResult = conflictResolutionService.evaluateConflict({
      organizationId: orgId,
      integrationId: installed.id,
      entityType: "INVENTORY",
      entityId: "prod_ops_01",
      commerceosData: { quantity: 150 },
      externalData: { quantity: 120 },
      conflictField: "quantity",
      configuredStrategy: "COMMERCEOS_WINS",
    });

    assert.strictEqual(conflictResult.hasConflict, true);
    assert.strictEqual(conflictResult.resolvedData.quantity, 150);
  });

  // -------------------------------------------------------------
  // 8. Developer Platform API Key Management & Rate Limiting
  // -------------------------------------------------------------
  await runTest("8.1 Developer Platform: Key Generation, SHA-256 Hashing & Verification", () => {
    const { application } = developerPlatformService.createApplication(orgId, {
      name: "ERP Enterprise Sync Tool",
      description: "Automated sync worker for enterprise warehouse",
      allowedScopes: ["read:orders", "write:inventory"],
      rateLimitPerMinute: 600,
    });
    assert.strictEqual(application.name, "ERP Enterprise Sync Tool");

    const { keyRecord, rawApiKey } = developerPlatformService.generateApiKey(orgId, {
      name: "Production Worker Key",
      scopes: ["read:orders", "write:inventory"],
      applicationId: application.id,
    });

    assert(rawApiKey.startsWith("cos_live_"));
    assert.strictEqual(keyRecord.application_id, application.id);

    // Verify key validation
    const authCheck = developerPlatformService.authenticateApiKey(orgId, rawApiKey);
    assert.strictEqual(authCheck.valid, true);
    assert.strictEqual(authCheck.keyRecord?.id, keyRecord.id);

    // Verify invalid key rejects
    const invalidAuth = developerPlatformService.authenticateApiKey(orgId, "cos_live_invalid_entropy_123");
    assert.strictEqual(invalidAuth.valid, false);

    // Verify rate limiter
    const rateCheck = developerPlatformService.checkRateLimit(keyRecord.id, 600);
    assert.strictEqual(rateCheck.allowed, true);
  });

  // -------------------------------------------------------------
  // 9. Enterprise Webhook Platform HMAC Signing
  // -------------------------------------------------------------
  await runTest("9.1 Webhook Platform: HMAC-SHA256 Signature Verification & Dispatch Simulation", async () => {
    const sub = webhookPlatformService.subscribe(orgId, {
      targetUrl: "https://warehouse-erp.apex.com/webhook",
      eventTypes: ["order.created", "inventory.low_stock"],
    });

    assert.strictEqual(sub.target_url, "https://warehouse-erp.apex.com/webhook");

    const payload = JSON.stringify({ event: "order.created", order_id: "ord_9901", total: 4500 });
    const signature = webhookPlatformService.computeSignature(payload, sub.secret);

    assert(signature.length === 64, "SHA-256 signature should be 64 hex characters");

    const isValid = webhookPlatformService.verifySignature(payload, sub.secret, signature);
    assert.strictEqual(isValid, true, "Signature must verify successfully");

    const isTampered = webhookPlatformService.verifySignature(
      JSON.stringify({ event: "order.created", order_id: "ord_9901", total: 99999 }),
      sub.secret,
      signature
    );
    assert.strictEqual(isTampered, false, "Tampered payload must fail signature verification");

    const dispatchRecords = await webhookPlatformService.dispatchEvent({
      organizationId: orgId,
      eventType: "order.created",
      payload: { order_id: "ord_9901", amount: 4500 },
    });
    assert(dispatchRecords.length >= 1);
    // Signed and recorded, but no HTTP delivery exists: never "DELIVERED" (FX-31)
    assert.strictEqual(dispatchRecords[0].status, "NOT_SENT");
    assert.strictEqual(dispatchRecords[0].http_status, undefined);
    assert.strictEqual(dispatchRecords[0].duration_ms, null);
    assert.strictEqual(dispatchRecords[0].signature.length, 64);
  });

  // -------------------------------------------------------------
  // 10. Data Governance, PII Masking & Defect Profiling
  // -------------------------------------------------------------
  await runTest("10.1 Data Governance & Quality: PII Masking and Defect Profiling", () => {
    const unmaskedPayload = {
      name: "Tanzim Hasan",
      phone: "+8801711234567",
      email: "tanzim@gmail.com",
      address: "House 12, Road 4, Dhanmondi, Dhaka",
    };

    // Standard user clearance -> Masked
    const masked = dataGovernanceService.maskPII(unmaskedPayload, "STANDARD_ACCESS");
    assert.strictEqual(masked.phone, "+88017****567");
    assert.strictEqual(masked.email, "t***m@gmail.com");

    // Restricted access -> Full fidelity
    const unmasked = dataGovernanceService.maskPII(unmaskedPayload, "RESTRICTED_ACCESS");
    assert.strictEqual(unmasked.phone, "+8801711234567");

    // Seed defect order to verify data quality defect identification
    db.createOrder({
      id: "ord_defect_test",
      tenant_id: tenantId,
      order_number: "ORD-DEFECT-01",
      customer_id: "cust_test",
      order_source: "WEBSITE",
      items: [],
      subtotal: 1000,
      grand_total: 1000,
      total_amount: 1000,
      payment_status: "PENDING",
      fulfillment_status: "UNFULFILLED",
      status: "CONFIRMED",
      currency: "BDT",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, []);

    const issues = dataQualityService.runQualityAudit(orgId, tenantId);
    assert(issues.length >= 1, "Should identify data quality defect for order missing address");
    assert.strictEqual(issues[0].entity_type, "ORDER");
  });

  // -------------------------------------------------------------
  // 11. Customer Identity Cross-Store Resolution
  // -------------------------------------------------------------
  await runTest("11.1 Customer Identity: Cross-Store Ingestion and Deterministic Stitching", () => {
    const resA = enterpriseCustomerIdentityService.resolveIdentity({
      organizationId: orgId,
      storeId: "str_dhk_flagship",
      name: "Kazi Nabil",
      phone: "+8801712998877",
      email: "kazi.nabil@gmail.com",
    });

    const resB = enterpriseCustomerIdentityService.resolveIdentity({
      organizationId: orgId,
      storeId: "str_us_online",
      name: "Kazi N.",
      phone: "+8801712998877",
      email: "knabil@yahoo.com",
    });

    // Deterministic match on verified BD phone number
    assert.strictEqual(resA.identity.id, resB.identity.id, "Both customer records should resolve to identical unified identity");
    assert.strictEqual(resB.matchType, "EXACT_PHONE");
    assert.strictEqual(resB.isNew, false);
    assert(resB.identity.store_affiliations.includes("str_dhk_flagship"));
    assert(resB.identity.store_affiliations.includes("str_us_online"));
  });

  // -------------------------------------------------------------
  // 12. Enterprise Pricing & Catalog Policy Hierarchy
  // -------------------------------------------------------------
  await runTest("12.1 Enterprise Pricing: Multi-Level Margin Floor Hierarchy (Enterprise > Brand > Store)", () => {
    // Enterprise floor 25%, Brand floor 20%, Store floor 15%
    // Proposed price yields 22% margin -> Fails because Enterprise floor is 25% (most restrictive wins)
    const check1 = enterprisePricingService.evaluatePriceChange({
      enterpriseMinMarginPct: 25,
      brandMinMarginPct: 20,
      storeMinMarginPct: 15,
      costPrice: 780,
      proposedPrice: 1000,
    });

    assert.strictEqual(check1.allowed, false);
    assert.strictEqual(check1.effectiveMinMarginPct, 25);
    assert.strictEqual(check1.policySource, "ENTERPRISE_FLOOR");

    // Proposed price yields 30% margin -> Passes
    const check2 = enterprisePricingService.evaluatePriceChange({
      enterpriseMinMarginPct: 25,
      brandMinMarginPct: 20,
      storeMinMarginPct: 15,
      costPrice: 700,
      proposedPrice: 1000,
    });

    assert.strictEqual(check2.allowed, true);
    assert.strictEqual(check2.projectedMarginPct, 30);
  });

  // -------------------------------------------------------------
  // 13. Enterprise Incident Triage & Operations
  // -------------------------------------------------------------
  await runTest("13.1 Enterprise Operations: Incident Lifecycle & State Transitions", () => {
    const incident = enterpriseIncidentService.createIncident(orgId, {
      title: "SAP Inbound Inventory Sync Failure",
      domain: "INTEGRATION",
      severity: "HIGH",
      impactedEntities: { integrations: ["prov_sap"] },
      rootCause: "SAP gateway token expired",
      mitigationPlan: "Force OAuth credential refresh",
    });

    assert.strictEqual(incident.status, "DETECTED");
    assert.strictEqual(incident.severity, "HIGH");

    const investigating = enterpriseIncidentService.transitionStatus(orgId, incident.id, "INVESTIGATING");
    assert.strictEqual(investigating.status, "INVESTIGATING");

    const resolved = enterpriseIncidentService.transitionStatus(
      orgId,
      incident.id,
      "RESOLVED",
      "Credentials successfully renewed and backoff queue drained"
    );
    assert.strictEqual(resolved.status, "RESOLVED");
    assert(resolved.resolved_at !== undefined);
  });

  // -------------------------------------------------------------
  // 14. Enterprise Supervisor Agent Multi-Entity Planning
  // -------------------------------------------------------------
  await runTest("14.1 Enterprise Supervisor Agent: Cross-Store Multi-Agent Orchestration", () => {
    const steps = enterpriseSupervisorAgent.decomposeEnterpriseObjective({
      organizationId: orgId,
      objective: "balance inventory and cross-store rebalance across Dhaka Flagship and Online Store",
    });

    assert(steps.length >= 3, "Plan must contain subtasks for audit, transfer, and pricing");
    const taskTypes = steps.map((s) => s.task_type);
    assert(taskTypes.includes("AUDIT_GLOBAL_INVENTORY"));
    assert(taskTypes.includes("EVALUATE_INTER_STORE_TRANSFERS"));

    const agents = steps.map((s) => s.agent_type);
    assert(agents.includes("ENTERPRISE_INVENTORY"));
    assert(agents.includes("ENTERPRISE_FINANCE"));
  });

  // -------------------------------------------------------------
  // 15. Tool Registry & Agent Registry Verifications
  // -------------------------------------------------------------
  await runTest("15.1 Enterprise Tool & Agent Registration Verification", () => {
    const tools = toolRegistry.listTools();
    const enterpriseTools = tools.filter((t) => t.category === "ENTERPRISE");
    assert(
      enterpriseTools.length >= 16,
      `Expected at least 16 enterprise tools, found ${enterpriseTools.length}`
    );

    const enterpriseAgentTypes = [
      "ENTERPRISE_SUPERVISOR",
      "ENTERPRISE_INTELLIGENCE",
      "ENTERPRISE_ANALYTICS",
      "BENCHMARKING",
      "INTEGRATION",
      "DATA_GOVERNANCE",
      "DATA_QUALITY",
      "ENTERPRISE_OPERATIONS",
      "ENTERPRISE_FINANCE",
      "ENTERPRISE_INVENTORY",
      "ENTERPRISE_PROCUREMENT",
      "ENTERPRISE_SECURITY",
      "ENTERPRISE_REPORTING",
      "ECOSYSTEM",
      "DEVELOPER_PLATFORM",
    ];

    const agents = agentRegistry.getAllAgents();
    const registeredEnterpriseAgents = agents.filter((a) =>
      enterpriseAgentTypes.includes(a.agent_type)
    );
    assert.strictEqual(
      registeredEnterpriseAgents.length,
      15,
      `Expected all 15 enterprise agents to be registered, found ${registeredEnterpriseAgents.length}`
    );
  });

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}----------------------------------------------------------------${ANSI_RESET}`);
  console.log(`Phase 9 Enterprise Test Run Results: ${ANSI_GREEN}${passedCount} Passed${ANSI_RESET}, ${failedCount > 0 ? `${ANSI_RED}${failedCount} Failed${ANSI_RESET}` : "0 Failed"}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Direct CLI invocation
runEnterpriseTests().catch((err) => {
  console.error("Test execution aborted with error:", err);
  process.exit(1);
});
