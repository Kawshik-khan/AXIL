/**
 * Workspace authenticator and step-up (AI fix plan FX-97 Part A). Enrolment needs the password; codes can't be replayed;
 * recovery codes work once; step-up tokens are bound to the user and session; platform and workspace step-up tokens
 * never stand in for each other; enforcement starts on WORKSPACE_STEP_UP_ENFORCED_FROM.
 */
import assert from "assert";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { extractRequestContext, extractPlatformContext } from "@/lib/api-response";
import { requireStepUp, stepUpEnforced } from "@/lib/step-up";
import { signPlatformSessionToken, signSessionToken, signStepUpToken, verifyStepUpToken, WORKSPACE_STEP_UP_PREFIX } from "@/lib/security";
import { generateTotp } from "@/lib/totp";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(err);
    failed++;
  }
}

const BASE = "http://localhost:3000/api/v1";
type Handler = (request: Request) => Promise<Response>;

async function main() {
  console.log(`\n${BOLD}WORKSPACE MFA AND STEP-UP (FX-97 Part A)${RESET}\n`);
  db.clearAllForTesting();
  const stamp = Date.now();
  const password = "Workspace-Mfa-Pass-2026!";
  const reg = await AuthService.registerTenantWithOwner({ workspaceName: `MFA Shop ${stamp}`, name: "MFA Owner", email: `mfa-${stamp}@example.com`, password, currency: "BDT" });
  const userId = reg.user.id;
  const tenantId = reg.tenant.id;
  const session = () => signSessionToken({ userId, tenantId, role: "OWNER", email: reg.user.email, name: reg.user.name, sv: db.findUserById(userId)?.session_version ?? 1 });
  const call = async (path: string, method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) => {
    const mod = (await import(`@/app/api/v1/${path}/route`)) as Partial<Record<"GET" | "POST", Handler>>;
    return mod[method]!(new Request(`${BASE}/${path}`, {
      method,
      headers: { authorization: `Bearer ${await session()}`, "content-type": "application/json", ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
  };
  const json = async (res: Response) => (await res.json()) as { data?: Record<string, unknown>; error?: { code: string } };
  let secret = "";
  let recovery: string[] = [];

  await runTest("enrolment needs the account password again", async () => {
    const wrong = await call("auth/mfa/enroll", "POST", { password: "not-the-password" });
    assert.strictEqual(wrong.status, 400);
    assert.strictEqual((await json(wrong)).error?.code, "INVALID_PASSWORD");
    const ok = await call("auth/mfa/enroll", "POST", { password });
    assert.strictEqual(ok.status, 200);
    secret = String((await json(ok)).data?.secret);
    assert.ok(secret.length >= 16);
    assert.strictEqual(WorkspaceMfaService.isEnrolled(userId), false, "nothing is on until a code is confirmed");
  });

  await runTest("a valid code turns it on and returns 10 single-use recovery codes, shown once", async () => {
    const res = await call("auth/mfa/confirm", "POST", { code: generateTotp(secret, Date.now() - 30_000) });
    assert.strictEqual(res.status, 200);
    recovery = (await json(res)).data?.recovery_codes as string[];
    assert.strictEqual(recovery.length, 10);
    assert.ok(WorkspaceMfaService.isEnrolled(userId));
    const status = await json(await call("auth/mfa", "GET"));
    assert.strictEqual(status.data?.enrolled, true);
    assert.strictEqual(status.data?.recovery_codes_left, 10);
    const stored = JSON.stringify(db.findUserById(userId));
    assert.ok(!stored.includes(secret), "the secret is stored encrypted");
    assert.ok(!recovery.some((c) => stored.includes(c)), "recovery codes are stored hashed");
  });

  let stepUpToken = "";
  await runTest("step-up with a fresh code returns a workspace token; the same code can't be used twice", async () => {
    const code = generateTotp(secret);
    const res = await call("auth/step-up", "POST", { code, action: "APPROVE_PRICE_CHANGE" });
    assert.strictEqual(res.status, 200);
    stepUpToken = String((await json(res)).data?.stepUpToken);
    const claims = await verifyStepUpToken(stepUpToken, userId);
    assert.ok(claims?.action.startsWith(WORKSPACE_STEP_UP_PREFIX));
    const replay = await call("auth/step-up", "POST", { code });
    assert.strictEqual(replay.status, 400);
  });

  await runTest("a recovery code works once", async () => {
    assert.strictEqual(WorkspaceMfaService.verifyCode(userId, recovery[0]), true);
    assert.strictEqual(WorkspaceMfaService.verifyCode(userId, recovery[0]), false);
    assert.strictEqual(WorkspaceMfaService.verifyCode(userId, "ZZZZZ-ZZZZZ"), false);
    assert.strictEqual(db.findUserById(userId)?.mfa_recovery_hashes?.length, 9);
  });

  await runTest("the request context marks step-up only for this user's workspace token", async () => {
    const withToken = async (token: string) =>
      extractRequestContext(new Request(`${BASE}/orders`, { headers: { authorization: `Bearer ${await session()}`, "x-step-up-token": token } }));
    assert.strictEqual((await withToken(stepUpToken)).stepUpVerified, true);
    const platformToken = await signStepUpToken(userId, "PRIVILEGED_ACTION", 1);
    assert.strictEqual((await withToken(platformToken)).stepUpVerified, false, "a platform step-up token doesn't count here");
    const someoneElse = await signStepUpToken("usr_other", `${WORKSPACE_STEP_UP_PREFIX}X`, 1);
    assert.strictEqual((await withToken(someoneElse)).stepUpVerified, false);
  });

  await runTest("the platform console refuses a workspace step-up token (enrolment there needs only the password)", async () => {
    const now = new Date().toISOString();
    db.savePlatformMembership({ id: `pm_${stamp}`, user_id: userId, role: "PLATFORM_ADMIN", mfa_enabled: false, is_active: true, created_at: now, updated_at: now } as never);
    const platformSession = await signPlatformSessionToken({ userId, email: reg.user.email, platformRole: "PLATFORM_ADMIN", mfaVerified: true, sv: 1 });
    const ctx = await extractPlatformContext(new Request(`${BASE}/platform/overview`, { headers: { authorization: `Bearer ${platformSession}`, "x-step-up-token": stepUpToken } }));
    assert.strictEqual(ctx.stepUpVerified, false);
    const real = await signStepUpToken(userId, "PRIVILEGED_ACTION", 1);
    const ok = await extractPlatformContext(new Request(`${BASE}/platform/overview`, { headers: { authorization: `Bearer ${platformSession}`, "x-step-up-token": real } }));
    assert.strictEqual(ok.stepUpVerified, true);
  });

  await runTest("a step-up token is bound to the session version: signing out everywhere cancels it", async () => {
    assert.ok(await verifyStepUpToken(stepUpToken, userId, 1));
    assert.strictEqual(await verifyStepUpToken(stepUpToken, userId, 2), null);
  });

  const ctx = (stepUpVerified: boolean, user = userId): RequestContext => ({
    requestId: "r", traceId: "t", user: { id: user, email: "x@example.com", name: "x", status: "ACTIVE" },
    tenant: { id: tenantId, name: "t", slug: "t", currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER", permissions: Object.values(PERMISSIONS), timestamp: new Date().toISOString(), stepUpVerified,
  });
  const withEnforcement = async (from: string | undefined, fn: () => Promise<void> | void) => {
    const saved = process.env.WORKSPACE_STEP_UP_ENFORCED_FROM;
    if (from === undefined) delete process.env.WORKSPACE_STEP_UP_ENFORCED_FROM;
    else process.env.WORKSPACE_STEP_UP_ENFORCED_FROM = from;
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.WORKSPACE_STEP_UP_ENFORCED_FROM;
      else process.env.WORKSPACE_STEP_UP_ENFORCED_FROM = saved;
    }
  };
  const code = (fn: () => void) => {
    try {
      fn();
      return "ALLOWED";
    } catch (err) {
      return err instanceof AppError ? err.code : String(err);
    }
  };

  await runTest("before the enforcement date (or with none set) a missing step-up is allowed and logged", async () => {
    await withEnforcement(undefined, () => {
      assert.strictEqual(stepUpEnforced(), false);
      assert.strictEqual(code(() => requireStepUp(ctx(false), "TEST")), "ALLOWED");
    });
    await withEnforcement("2999-01-01", () => assert.strictEqual(code(() => requireStepUp(ctx(false), "TEST")), "ALLOWED"));
  });

  await runTest("after it: no authenticator → MFA_ENROLLMENT_REQUIRED; enrolled without step-up → STEP_UP_REQUIRED; with → allowed", async () => {
    const other = await AuthService.registerTenantWithOwner({ workspaceName: `MFA Other ${stamp}`, name: "No MFA", email: `nomfa-${stamp}@example.com`, password, currency: "BDT" });
    await withEnforcement("2020-01-01", () => {
      assert.strictEqual(code(() => requireStepUp(ctx(false, other.user.id), "TEST")), "MFA_ENROLLMENT_REQUIRED");
      assert.strictEqual(code(() => requireStepUp(ctx(false), "TEST")), "STEP_UP_REQUIRED");
      assert.strictEqual(code(() => requireStepUp(ctx(true), "TEST")), "ALLOWED");
    });
  });

  await runTest("enforced: approving a price change without step-up is refused before anything runs", async () => {
    await withEnforcement("2020-01-01", async () => {
      const mod = (await import("@/app/api/v1/operations/actions/[id]/approve/route")) as {
        POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
      };
      const res = await mod.POST(
        new Request(`${BASE}/operations/actions/pcr_none/approve`, {
          method: "POST",
          headers: { authorization: `Bearer ${await session()}`, "content-type": "application/json" },
          body: JSON.stringify({ action_type: "PRICE_CHANGE", approved: true }),
        }),
        { params: Promise.resolve({ id: "pcr_none" }) }
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual((await json(res)).error?.code, "STEP_UP_REQUIRED");
    });
  });

  await runTest("the AI approvals route takes a strict body: a non-string action is 400, not a crash", async () => {
    const mod = (await import("@/app/api/v1/ai/approvals/[id]/route")) as {
      POST: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
    };
    const post = async (body: unknown) =>
      mod.POST(
        new Request(`${BASE}/ai/approvals/appr_none`, {
          method: "POST",
          headers: { authorization: `Bearer ${await session()}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: "appr_none" }) }
      );
    assert.strictEqual((await post({ action: 123 })).status, 400);
    assert.strictEqual((await post({ action: "APPROVE", extra: true })).status, 400);
    assert.strictEqual((await post({ action: "approve" })).status, 404, "a valid body reaches the lookup (no such approval)");
  });

  await runTest("the platform step-up route can't mint a workspace-prefixed token", async () => {
    const mod = (await import("@/app/api/v1/platform/auth/step-up/route")) as { POST: Handler };
    const platformSession = await signPlatformSessionToken({ userId, email: reg.user.email, platformRole: "PLATFORM_ADMIN", mfaVerified: true, sv: 1 });
    const res = await mod.POST(new Request(`${BASE}/platform/auth/step-up`, {
      method: "POST",
      headers: { authorization: `Bearer ${platformSession}`, "content-type": "application/json" },
      body: JSON.stringify({ code: "123456", action: "WORKSPACE:APPROVE" }),
    }));
    assert.notStrictEqual(res.status, 200);
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal workspace MFA test error:", err);
  process.exit(1);
});
