// @ts-ignore
import assert from "assert";
declare const process: { exit(code?: number): void };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { TenantService } from "@/domains/tenants/service";
import { UserService } from "@/domains/users/service";
import { RbacService } from "@/domains/rbac/service";
import { InvitationService } from "@/domains/invitations/service";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS } from "@/lib/permissions";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "@/lib/security";
import {
  AuthenticationError,
  ForbiddenError,
  UserSuspendedError,
} from "@/lib/errors";

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

console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 1: AUTOMATED VERIFICATION SUITE   ${ANSI_RESET}`);
console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

async function main() {
  // Reset test DB
  db.clearAllForTesting();

  // -------------------------------------------------------------
  // SUITE 1: SECURITY & AUTHENTICATION TESTS
  // -------------------------------------------------------------
  console.log(`${ANSI_BOLD}[1] Authentication & Cryptographic Security Tests${ANSI_RESET}`);

  await runTest("Password hashing and comparison with bcrypt", async () => {
    const rawPass = "CommerceOS2026!Secure";
    const hashed = await hashPassword(rawPass);
    assert.strictEqual(typeof hashed, "string");
    assert.ok(hashed.length > 20);

    const validMatch = await verifyPassword(rawPass, hashed);
    assert.strictEqual(validMatch, true, "Valid password should verify");

    const invalidMatch = await verifyPassword("WrongPassword123!", hashed);
    assert.strictEqual(invalidMatch, false, "Invalid password should fail");
  });

  await runTest("JWT Session Token signing and verification", async () => {
    const payload = {
      userId: "usr_test_123",
      tenantId: "ten_test_456",
      role: "OWNER" as const,
      email: "owner@test.com",
      name: "Test Owner",
    };
    const token = await signSessionToken(payload);
    assert.ok(token && typeof token === "string");

    const verified = await verifySessionToken(token);
    if (!verified) throw new Error("Session verification failed");
    assert.strictEqual(verified.userId, payload.userId);
    assert.strictEqual(verified.tenantId, payload.tenantId);
    assert.strictEqual(verified.role, payload.role);
  });

  await runTest("Tenant registration with owner account flow", async () => {
    const regResult = await AuthService.registerTenantWithOwner({
      email: "karim@chittagongsilk.com",
      password: "SuperSecretPassword123!",
      name: "Karim Chowdhury",
      workspaceName: "Chittagong Silk & Craft",
      currency: "BDT",
    });

    assert.ok(regResult.token);
    assert.strictEqual(regResult.role, "OWNER");
    assert.strictEqual(regResult.tenant.name, "Chittagong Silk & Craft");
    assert.strictEqual(regResult.tenant.currency, "BDT");
    assert.strictEqual(regResult.user.email, "karim@chittagongsilk.com");

    // Verify tenant exists in DB
    const tenantInDb = db.findTenantById(regResult.tenant.id);
    if (!tenantInDb) throw new Error("Tenant should exist in database");
    assert.strictEqual(tenantInDb.status, "ACTIVE");

    // Verify user exists and status is ACTIVE
    const userInDb = db.findUserByEmail("karim@chittagongsilk.com");
    if (!userInDb) throw new Error("User should exist in database");
    assert.strictEqual(userInDb.status, "ACTIVE");

    // Verify membership exists with OWNER role
    const membership = db.findMembership(regResult.tenant.id, userInDb.id);
    if (!membership) throw new Error("Membership should exist in database");
    assert.strictEqual(membership.role, "OWNER");
  });

  await runTest("Login flow with valid credentials", async () => {
    const loginResult = await AuthService.login(
      "karim@chittagongsilk.com",
      "SuperSecretPassword123!"
    );
    assert.ok(loginResult.token);
    assert.strictEqual(loginResult.user.email, "karim@chittagongsilk.com");
    assert.strictEqual(loginResult.role, "OWNER");
  });

  await runTest("Login rejection on incorrect password", async () => {
    let threw = false;
    try {
      await AuthService.login("karim@chittagongsilk.com", "WrongPassword999!");
    } catch (e) {
      threw = true;
      assert.ok(e instanceof AuthenticationError);
    }
    assert.strictEqual(threw, true, "Should reject incorrect password");
  });

  await runTest("Suspended user cannot log in", async () => {
    const user = db.findUserByEmail("karim@chittagongsilk.com");
    if (!user) throw new Error("User must exist in test database");
    UserService.updateUserStatus(user.id, "SUSPENDED");

    let threw = false;
    try {
      await AuthService.login("karim@chittagongsilk.com", "SuperSecretPassword123!");
    } catch (e) {
      threw = true;
      assert.ok(e instanceof UserSuspendedError);
    }
    assert.strictEqual(threw, true, "Suspended user must be denied login");

    // Restore to active
    UserService.updateUserStatus(user.id, "ACTIVE");
  });

  // -------------------------------------------------------------
  // SUITE 2: MANDATORY MULTI-TENANT ISOLATION TESTS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[2] Mandatory Multi-Tenant Boundary Isolation Tests${ANSI_RESET}`);

  // Create Tenant Alpha
  const tenantAlpha = await AuthService.registerTenantWithOwner({
    email: "alpha_owner@alphastore.com",
    password: "PasswordAlpha123!",
    name: "Alpha Owner",
    workspaceName: "Alpha Retailers",
  });

  // Create Tenant Beta
  const tenantBeta = await AuthService.registerTenantWithOwner({
    email: "beta_owner@betastore.com",
    password: "PasswordBeta123!",
    name: "Beta Owner",
    workspaceName: "Beta Brand",
  });

  await runTest("CRITICAL: Tenant Alpha cannot access Tenant Beta memberships", async () => {
    // Resolve context for Tenant Alpha Owner
    const contextAlpha = await AuthService.resolveRequestContext(tenantAlpha.token);
    assert.strictEqual(contextAlpha.tenant.id, tenantAlpha.tenant.id);

    // Query memberships for Tenant Alpha
    const alphaMemberships = db.findMembershipsByTenantId(contextAlpha.tenant.id);
    assert.ok(alphaMemberships.length > 0);

    // Verify NONE of Tenant Beta's users or memberships appear in Tenant Alpha's data
    const betaUserInAlpha = alphaMemberships.find(
      (m) => m.user_id === tenantBeta.user.id
    );
    assert.strictEqual(
      betaUserInAlpha,
      undefined,
      "Tenant Beta membership must NEVER appear in Tenant Alpha dataset!"
    );
  });

  await runTest("CRITICAL: Tenant Alpha cannot mutate Tenant Beta settings", async () => {
    const contextAlpha = await AuthService.resolveRequestContext(tenantAlpha.token);

    // Attempting to update settings through domain service using Tenant Alpha's tenant ID
    // cannot change Tenant Beta's settings
    TenantService.updateTenantSettings(contextAlpha.tenant.id, {
      name: "Alpha Retailers Renamed",
      currency: "USD",
    });

    const refreshedBeta = TenantService.getTenantById(tenantBeta.tenant.id);
    assert.strictEqual(
      refreshedBeta.name,
      "Beta Brand",
      "Tenant Beta name must remain unmutated by Tenant Alpha actions!"
    );
    assert.strictEqual(
      refreshedBeta.currency,
      "BDT",
      "Tenant Beta currency must remain BDT!"
    );
  });

  await runTest("CRITICAL: Tenant Alpha cannot view Tenant Beta audit logs", async () => {
    // Generate audit action in Tenant Beta
    AuditService.log({
      tenantId: tenantBeta.tenant.id,
      actorUserId: tenantBeta.user.id,
      action: "BETA_SECRET_ACTION",
      resourceType: "financial_record",
      resourceId: "fin_999",
      metadata: { private_revenue: 500000 },
    });

    // Query audit logs scoped strictly to Tenant Alpha
    const alphaLogs = AuditService.getLogsForTenant(tenantAlpha.tenant.id);
    const leakedLog = alphaLogs.logs.find(
      (l) => l.action === "BETA_SECRET_ACTION" || l.tenant_id === tenantBeta.tenant.id
    );

    assert.strictEqual(
      leakedLog,
      undefined,
      "Tenant Alpha audit query must NEVER return Tenant Beta audit records!"
    );
  });

  // -------------------------------------------------------------
  // SUITE 3: ROLE-BASED ACCESS CONTROL (RBAC) TESTS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[3] Role-Based Access Control (RBAC) Permission Tests${ANSI_RESET}`);

  await runTest("OWNER possesses full permissions across all scopes", async () => {
    const ownerPerms = RbacService.getPermissionsForRole("OWNER");
    assert.strictEqual(ownerPerms.length, Object.values(PERMISSIONS).length);
    assert.ok(ownerPerms.includes(PERMISSIONS.WORKSPACE_UPDATE));
    assert.ok(ownerPerms.includes(PERMISSIONS.USER_INVITE));
    assert.ok(ownerPerms.includes(PERMISSIONS.SETTINGS_UPDATE));
    assert.ok(ownerPerms.includes(PERMISSIONS.AUDIT_READ));
  });

  await runTest("ADMIN can invite users, update settings, but cannot delete workspace", async () => {
    const adminPerms = RbacService.getPermissionsForRole("ADMIN");
    assert.ok(adminPerms.includes(PERMISSIONS.USER_INVITE));
    assert.ok(adminPerms.includes(PERMISSIONS.SETTINGS_UPDATE));
    assert.ok(adminPerms.includes(PERMISSIONS.AUDIT_READ));
    assert.strictEqual(adminPerms.includes(PERMISSIONS.WORKSPACE_DELETE), false);
  });

  await runTest("SALES role has orders/products read/write but lacks settings/audit permissions", async () => {
    const salesPerms = RbacService.getPermissionsForRole("SALES");
    assert.ok(salesPerms.includes(PERMISSIONS.ORDERS_WRITE));
    assert.ok(salesPerms.includes(PERMISSIONS.PRODUCTS_READ));
    assert.strictEqual(salesPerms.includes(PERMISSIONS.SETTINGS_UPDATE), false);
    assert.strictEqual(salesPerms.includes(PERMISSIONS.AUDIT_READ), false);
    assert.strictEqual(salesPerms.includes(PERMISSIONS.USER_INVITE), false);
  });

  await runTest("SUPPORT role cannot mutate settings or alter financial ledgers", async () => {
    const supportPerms = RbacService.getPermissionsForRole("SUPPORT");
    assert.ok(supportPerms.includes(PERMISSIONS.SUPPORT_READ));
    assert.strictEqual(supportPerms.includes(PERMISSIONS.PAYMENTS_REFUND), false);
    assert.strictEqual(supportPerms.includes(PERMISSIONS.SETTINGS_UPDATE), false);
  });

  await runTest("ANALYST role is strictly read-only and cannot mutate data", async () => {
    const analystPerms = RbacService.getPermissionsForRole("ANALYST");
    assert.ok(analystPerms.includes(PERMISSIONS.ANALYTICS_READ));
    assert.strictEqual(analystPerms.includes(PERMISSIONS.ORDERS_WRITE), false);
    assert.strictEqual(analystPerms.includes(PERMISSIONS.PRODUCTS_WRITE), false);
    assert.strictEqual(analystPerms.includes(PERMISSIONS.USER_INVITE), false);
    assert.strictEqual(analystPerms.includes(PERMISSIONS.AGENT_CONFIGURE), false);
  });

  await runTest("DEV role possesses agent execution, telemetry, and read-only inspection", async () => {
    const devPerms = RbacService.getPermissionsForRole("DEV");
    assert.ok(devPerms.includes(PERMISSIONS.AGENT_RUN));
    assert.ok(devPerms.includes(PERMISSIONS.AGENT_CONFIGURE));
    assert.ok(devPerms.includes(PERMISSIONS.DASHBOARD_READ));
    assert.ok(devPerms.includes(PERMISSIONS.AUDIT_READ));
    assert.ok(devPerms.includes(PERMISSIONS.SETTINGS_READ));
    assert.ok(devPerms.includes(PERMISSIONS.PRODUCTS_READ));
    assert.ok(devPerms.includes(PERMISSIONS.ORDERS_READ));

    // Zero-tolerance prime directive: DEV cannot directly mutate financial or order data
    assert.strictEqual(devPerms.includes(PERMISSIONS.ORDERS_WRITE), false);
    assert.strictEqual(devPerms.includes(PERMISSIONS.PAYMENTS_REFUND), false);
    assert.strictEqual(devPerms.includes(PERMISSIONS.WORKSPACE_DELETE), false);
  });

  await runTest("assertCan() enforces permission boundaries and throws ForbiddenError", async () => {
    // Create sales user context
    const salesContext = {
      requestId: "req_test",
      traceId: "trc_test",
      user: { id: "usr_sales_1", email: "sales@test.com", name: "Sales Rep", status: "ACTIVE" as const },
      tenant: { id: tenantAlpha.tenant.id, name: "Alpha", slug: "alpha", currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" as const, settings: {} },
      role: "SALES" as const,
      permissions: RbacService.getPermissionsForRole("SALES"),
      timestamp: new Date().toISOString(),
    };

    // Sales can read dashboard
    assert.doesNotThrow(() => {
      RbacService.assertCan(salesContext, PERMISSIONS.DASHBOARD_READ);
    });

    // Sales CANNOT update workspace settings
    let forbiddenThrew = false;
    try {
      RbacService.assertCan(salesContext, PERMISSIONS.SETTINGS_UPDATE);
    } catch (e) {
      forbiddenThrew = true;
      assert.ok(e instanceof ForbiddenError);
    }
    assert.strictEqual(forbiddenThrew, true, "Sales role must be forbidden from updating settings");
  });

  // -------------------------------------------------------------
  // SUITE 4: INVITATION & TEAM ONBOARDING LIFECYCLE TESTS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[4] Invitation & Team Member Onboarding Tests${ANSI_RESET}`);

  await runTest("Admin invites new member -> Generates secure expiring invitation", async () => {
    const inv = InvitationService.createInvitation(
      tenantAlpha.tenant.id,
      "manager@alphastore.com",
      "MANAGER",
      tenantAlpha.user.id
    );

    assert.ok(inv.id);
    assert.strictEqual(inv.email, "manager@alphastore.com");
    assert.strictEqual(inv.role, "MANAGER");
    assert.strictEqual(inv.status, "PENDING");
    assert.ok(inv.token.length >= 32);

    // Look up by token
    const fetched = InvitationService.getInvitationByToken(inv.token);
    assert.strictEqual(fetched.id, inv.id);
  });

  await runTest("Accepting invitation creates user membership in tenant", async () => {
    // Create invitee user
    const invitee = db.createUser({
      id: "usr_new_manager",
      email: "manager@alphastore.com",
      name: "Farhan Ahmed",
      password_hash: await hashPassword("ManagerPass123!"),
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const pendingInv = InvitationService.getInvitationsForTenant(tenantAlpha.tenant.id).find(
      (i) => i.email === "manager@alphastore.com" && i.status === "PENDING"
    );
    if (!pendingInv) throw new Error("Pending invitation must exist");

    const result = InvitationService.acceptInvitation(pendingInv.token, invitee.id);
    assert.strictEqual(result.tenantId, tenantAlpha.tenant.id);
    assert.strictEqual(result.role, "MANAGER");

    // Verify membership exists
    const membership = db.findMembership(tenantAlpha.tenant.id, invitee.id);
    if (!membership) throw new Error("Membership must exist");
    assert.strictEqual(membership.role, "MANAGER");

    // Verify invitation is marked ACCEPTED
    const updatedInv = db.findInvitationByToken(pendingInv.token);
    if (!updatedInv) throw new Error("Updated invitation must exist");
    assert.strictEqual(updatedInv.status, "ACCEPTED");
  });

  // -------------------------------------------------------------
  // SUITE 5: AUDIT LOGGING IMMUTABILITY TESTS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[5] Audit Logging & Operational Trail Tests${ANSI_RESET}`);

  await runTest("Audit logging records security events with actor and tenant context", async () => {
    const auditRecord = AuditService.log({
      tenantId: tenantAlpha.tenant.id,
      actorUserId: tenantAlpha.user.id,
      action: "SETTINGS_UPDATED",
      resourceType: "tenant",
      resourceId: tenantAlpha.tenant.id,
      metadata: { delivery_fee_inside: 70 },
      ipAddress: "127.0.0.1",
      userAgent: "CommerceOS-Test-Runner/1.0",
    });

    assert.ok(auditRecord.id);
    assert.strictEqual(auditRecord.action, "SETTINGS_UPDATED");
    assert.strictEqual(auditRecord.tenant_id, tenantAlpha.tenant.id);
    assert.strictEqual(auditRecord.actor_user_id, tenantAlpha.user.id);
    assert.strictEqual(auditRecord.metadata.delivery_fee_inside, 70);

    const logs = AuditService.getLogsForTenant(tenantAlpha.tenant.id);
    assert.ok(logs.total > 0);
    const found = logs.logs.find((l) => l.id === auditRecord.id);
    assert.ok(found);
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`   TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test suite failure:", err);
  process.exit(1);
});
