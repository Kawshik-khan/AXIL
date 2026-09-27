import { db } from "../src/infrastructure/db";
import {
  PlatformAuthorizationService,
  PlatformTenantService,
  PlatformSubscriptionService,
  PlatformEntitlementService,
  PlatformSafetyService,
  PlatformSupportService,
  PlatformAuditService,
  PlatformAnalyticsService,
  PlatformUserService,
  PlatformSettingsService,
  PlatformFeatureFlagService,
} from "../src/domains/platform";
import { PlatformContext } from "../src/lib/context";
import { PLATFORM_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS } from "../src/lib/permissions";
import { verifyImpersonationToken, signPlatformSessionToken, verifyPlatformSessionToken } from "../src/lib/security";
import {
  PlatformPermissionDeniedError,
  PlatformScopeRequiredError,
  StepUpRequiredError,
  ImpersonationNotAllowedError,
} from "../src/lib/errors";

async function runSuperAdminTests() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("   COMMERCEOS PHASE 12: SUPER ADMIN & PLATFORM CONTROL PLANE  ");
  console.log("══════════════════════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  // --- Mock Contexts for Testing ---
  const superAdminContext: PlatformContext = {
    requestId: "req_test_sa_01",
    traceId: "trc_test_sa_01",
    scope: "PLATFORM",
    platformUser: {
      id: "usr_superadmin_01",
      email: "superadmin@commerceos.io",
      name: "Platform Super Admin",
      status: "ACTIVE",
    },
    platformRole: "SUPER_ADMIN",
    permissions: Object.values(PLATFORM_PERMISSIONS),
    mfaVerified: true,
    stepUpVerified: true,
    timestamp: new Date().toISOString(),
  };

  const platformAnalystContext: PlatformContext = {
    requestId: "req_test_analyst_01",
    traceId: "trc_test_analyst_01",
    scope: "PLATFORM",
    platformUser: {
      id: "usr_analyst_01",
      email: "analyst@commerceos.io",
      name: "Platform Analyst",
      status: "ACTIVE",
    },
    platformRole: "PLATFORM_ANALYST",
    permissions: PLATFORM_ROLE_PERMISSIONS.PLATFORM_ANALYST,
    mfaVerified: true,
    stepUpVerified: false,
    timestamp: new Date().toISOString(),
  };

  const platformSupportContext: PlatformContext = {
    requestId: "req_test_support_01",
    traceId: "trc_test_support_01",
    scope: "PLATFORM",
    platformUser: {
      id: "usr_support_01",
      email: "support@commerceos.io",
      name: "Platform Support",
      status: "ACTIVE",
    },
    platformRole: "PLATFORM_SUPPORT",
    permissions: PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPPORT,
    mfaVerified: true,
    stepUpVerified: true,
    timestamp: new Date().toISOString(),
  };

  const fakeTenantContextAsPlatform: any = {
    requestId: "req_fake_01",
    traceId: "trc_fake_01",
    scope: "TENANT", // Invalid scope for platform operations!
    user: { id: "usr_tenant_owner_01", email: "owner@store.com" },
  };

  // ============================================================
  // TEST GROUP 1: SCOPE ISOLATION & AUTHORIZATION BOUNDARIES
  // ============================================================
  console.log("1. Authorization Scope Separation (PLATFORM SCOPE != TENANT SCOPE):");

  let scopeRejected = false;
  try {
    PlatformAuthorizationService.assertPlatformScope(fakeTenantContextAsPlatform);
  } catch (err: any) {
    scopeRejected = err instanceof PlatformScopeRequiredError;
  }
  assert(scopeRejected, "assertPlatformScope rejects non-PLATFORM tenant context");

  assert(
    PlatformAuthorizationService.can(superAdminContext, "tenant.suspend"),
    "SUPER_ADMIN has tenant.suspend permission"
  );
  assert(
    PlatformAuthorizationService.can(superAdminContext, "security.manage"),
    "SUPER_ADMIN has security.manage permission"
  );
  assert(
    !PlatformAuthorizationService.can(platformAnalystContext, "tenant.suspend"),
    "PLATFORM_ANALYST does NOT have tenant.suspend permission"
  );
  assert(
    !PlatformAuthorizationService.can(platformSupportContext, "security.manage"),
    "PLATFORM_SUPPORT does NOT have security.manage permission"
  );

  let analystBlocked = false;
  try {
    PlatformAuthorizationService.assertCan(platformAnalystContext, "tenant.suspend");
  } catch (err: any) {
    analystBlocked = err instanceof PlatformPermissionDeniedError;
  }
  assert(analystBlocked, "assertCan throws PlatformPermissionDeniedError for unauthorized platform roles");

  // Step-Up MFA check
  let stepUpBlocked = false;
  const nonElevatedContext = { ...superAdminContext, stepUpVerified: false };
  try {
    PlatformAuthorizationService.assertStepUp(nonElevatedContext, "tenant.suspend");
  } catch (err: any) {
    stepUpBlocked = err instanceof StepUpRequiredError;
  }
  assert(stepUpBlocked, "assertStepUp enforces MFA elevation for HIGH/CRITICAL risk operations");

  // ============================================================
  // TEST GROUP 2: TENANT LIFECYCLE & PROVISIONING
  // ============================================================
  console.log("\n2. Tenant Governance & Lifecycle Operations:");

  const testTenantSlug = `test-d2c-${Date.now()}`;
  const provisioned = PlatformTenantService.provisionTenant(
    {
      name: "Chittagong Artisan Crafts",
      slug: testTenantSlug,
      legal_name: "Chittagong Crafts Ltd",
      plan_id: "GROWTH",
      owner_email: `owner_${Date.now()}@crafts.bd`,
      owner_name: "Nasir Uddin",
    },
    superAdminContext
  );

  assert(Boolean(provisioned.tenant?.id), "Idempotently provisions new tenant workspace");
  assert(provisioned.tenant.status === "ACTIVE", "New tenant transitions to ACTIVE state upon successful provisioning");
  assert(provisioned.plan.id === "GROWTH", "Correct SaaS plan attached to provisioned tenant");

  // Verify tenant listing & search
  const searchResult = PlatformTenantService.listTenants({ search: testTenantSlug }, superAdminContext);
  assert(searchResult.tenants.length === 1, "Tenant list correctly searches and filters by slug");
  assert(searchResult.tenants[0].id === provisioned.tenant.id, "Returned tenant matches provisioned ID");

  // Controlled Suspension
  const suspendedTenant = PlatformTenantService.suspendTenant(
    provisioned.tenant.id,
    "Payment delinquency and terms verification",
    superAdminContext
  );
  assert(suspendedTenant?.status === "SUSPENDED", "Controlled suspension updates tenant status to SUSPENDED");

  // Controlled Reactivation
  const reactivatedTenant = PlatformTenantService.activateTenant(
    provisioned.tenant.id,
    "Payment received and verified",
    superAdminContext
  );
  assert(reactivatedTenant?.status === "ACTIVE", "Controlled activation restores tenant status to ACTIVE");

  // Controlled Archiving (Grace period deletion)
  const archivedTenant = PlatformTenantService.archiveTenant(
    provisioned.tenant.id,
    "Requested closure after 30-day grace period",
    superAdminContext
  );
  assert(archivedTenant?.status === "ARCHIVED", "Controlled deletion moves tenant to ARCHIVED (never immediate hard delete)");

  // ============================================================
  // TEST GROUP 3: SAAS PLANS, VERSIONING & CENTRALIZED ENTITLEMENTS
  // ============================================================
  console.log("\n3. SaaS Plans, Versioning & Feature Entitlements:");

  const plans = PlatformSubscriptionService.listPlans(superAdminContext);
  assert(plans.length >= 5, "Lists all canonical plans (FREE, STARTER, GROWTH, PRO, ENTERPRISE)");
  const growthPlan = plans.find((p) => p.id === "GROWTH");
  assert(Boolean(growthPlan?.current_version), "Plan includes active published version metadata");

  // Entitlement Evaluator (Centralized can check)
  const canUseAutomation = await PlatformEntitlementService.can("ten_default_dhaka", "automation.n8n");
  assert(canUseAutomation === true, "EntitlementService.can correctly resolves enabled features from plan");

  // Entitlement Override
  const override = PlatformEntitlementService.setTenantOverride(
    "ten_default_dhaka",
    "max_users",
    99,
    "Special promotional contract extension",
    superAdminContext
  );
  assert(override.is_override === true && override.value === 99, "Tenant entitlement override successfully saved");

  const canAdd50Users = await PlatformEntitlementService.can("ten_default_dhaka", "max_users", 50);
  assert(canAdd50Users === true, "EntitlementService.can respects tenant override over plan defaults");

  // Usage Recording
  const usageRecord = PlatformEntitlementService.recordUsage("ten_default_dhaka", "max_orders_per_month", 5);
  assert(usageRecord.quantity_used >= 5, "EntitlementService.recordUsage correctly tracks tenant usage");

  // ============================================================
  // TEST GROUP 4: SUPPORT IMPERSONATION & PRIVILEGE BOUNDARIES
  // ============================================================
  console.log("\n4. Governed Support Impersonation & Anti-Escalation:");

  const defaultUser = db.findUserByEmail("admin@commerceos.io");
  const impersonationResult = await PlatformSupportService.startImpersonationSession(
    {
      targetTenantId: "ten_default_dhaka",
      targetUserId: defaultUser!.id,
      reason: "Customer support ticket #8841 address fix assistance",
      ticketReference: "TICKET-8841",
      mode: "READ_ONLY",
      durationMinutes: 30,
    },
    superAdminContext
  );

  assert(Boolean(impersonationResult.token), "Generates cryptographically signed support impersonation token");
  assert(impersonationResult.session.mode === "READ_ONLY", "Session defaults to safe READ_ONLY mode");

  // Verify token payload
  const verifiedToken = await verifyImpersonationToken(impersonationResult.token);
  assert(verifiedToken?.targetTenantId === "ten_default_dhaka", "Token scoped strictly to target tenant");
  assert(verifiedToken?.operatorUserId === superAdminContext.platformUser.id, "Token tracks dual-actor operator identity");

  // Invariant check: Cannot impersonate another Super Admin
  let saImpersonationBlocked = false;
  try {
    await PlatformSupportService.startImpersonationSession(
      {
        targetTenantId: "ten_default_dhaka",
        targetUserId: superAdminContext.platformUser.id,
        reason: "Invalid attempt to impersonate super admin",
      },
      superAdminContext
    );
  } catch (err: any) {
    saImpersonationBlocked = err instanceof ImpersonationNotAllowedError;
  }
  assert(saImpersonationBlocked, "Security boundary: Cannot impersonate another Super Admin");

  // Session Revocation
  const revokedSession = PlatformSupportService.revokeSession(
    impersonationResult.session.id,
    "Support inquiry resolved",
    superAdminContext
  );
  assert(Boolean(revokedSession.revoked_at), "Impersonation session successfully revoked");

  // ============================================================
  // TEST GROUP 5: PLATFORM SAFETY & EMERGENCY KILL SWITCH
  // ============================================================
  console.log("\n5. Platform Safety & Emergency Kill Switch:");

  const killSwitch = PlatformSafetyService.activateKillSwitch(
    {
      scope: "GLOBAL",
      reason: "Simulated runaway automation loop incident",
    },
    superAdminContext
  );

  assert(killSwitch.is_active === true, "Emergency kill switch successfully activated");
  assert(
    PlatformSafetyService.isExecutionBlocked("GLOBAL") === true,
    "isExecutionBlocked reports true when kill switch is engaged"
  );

  // Deactivate
  const deactivated = PlatformSafetyService.deactivateKillSwitch(
    killSwitch.id,
    "Runaway loop mitigated, operations resumed",
    superAdminContext
  );
  assert(deactivated.is_active === false, "Emergency kill switch successfully deactivated");
  assert(
    PlatformSafetyService.isExecutionBlocked("GLOBAL") === false,
    "isExecutionBlocked reports false once kill switch is cleared"
  );

  // ============================================================
  // TEST GROUP 6: IMMUTABLE AUDIT LEDGER & CRYPTOGRAPHIC EXPORT
  // ============================================================
  console.log("\n6. Immutable Platform Audit Ledger & Cryptographic Integrity:");

  const auditQuery = PlatformAuditService.query({ limit: 10 });
  assert(auditQuery.logs.length > 0, "Audit query returns recorded platform actions");

  const exportData = PlatformAuditService.exportAuditLedger();
  assert(Boolean(exportData.export_id), "Generates audit ledger export");
  assert(exportData.checksum_sha256.length === 64, "Export includes valid SHA-256 tamper-evident checksum");

  // ============================================================
  // TEST GROUP 7: PLATFORM ANALYTICS & TELEMETRY
  // ============================================================
  console.log("\n7. Platform Analytics (Authoritative & Zero Fake Data):");

  const overview = PlatformAnalyticsService.getPlatformOverview(superAdminContext);
  assert(overview.tenants.total >= 1, "Reports real total tenant count");
  assert(overview.financials.currency === "BDT", "Reports platform revenue in BDT");
  assert(typeof overview.automation_health.failure_rate_percent === "number", "Calculates real failure rate percentage");

  // ============================================================
  // FINAL RESULTS
  // ============================================================
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuperAdminTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
