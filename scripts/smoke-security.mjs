/**
 * Phase 0 + Phase 1 exploit replay against a running server (FIX_IMPLEMENTATION_PLAN FX-08 / FX-65, verification matrix §11).
 * Each check replays an attack from the 2026-09-27 audit and expects it to fail.
 *
 *   BASE_URL=http://localhost:3000 node scripts/smoke-security.mjs
 *
 * Run it against a server started WITHOUT DEV_AUTH_BYPASS. It only sends requests: it prints status codes and
 * never prints tokens or passwords. Optional positive checks (a real sign-in must still work) run when set:
 *   SMOKE_TENANT_EMAIL / SMOKE_TENANT_PASSWORD        a workspace user
 *   SMOKE_PLATFORM_EMAIL / SMOKE_PLATFORM_PASSWORD    a platform operator
 * Exit code 1 when any check fails.
 */
import crypto from "node:crypto";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// Values that were public in the repository before Phase 0. They must no longer grant anything.
const PUBLISHED_DEFAULT_JWT_SECRET = "commerceos_super_secret_jwt_key_min_32_characters_for_security_2026";
const SHARED_DEFAULT_PASSWORDS = ["Password123!", "CommerceOS2026!"];
const LEGACY_META_VERIFY_TOKEN = "commerceos_meta_verify_token_2026";
const LEGACY_ROLE_HEADER = ["x", "test", "platform", "role"].join("-");

// Seeded identifiers (src/infrastructure/db/index.ts ensureDefaultSeed / automation seed).
const SEED_TENANT_ID = "ten_default_dhaka";
const SEED_OWNER_ID = "usr_owner_default";
const SEED_OWNER_EMAIL = "admin@commerceos.io";
const SEED_PLATFORM_ID = "usr_superadmin_01";
const SEED_PLATFORM_EMAIL = "superadmin@commerceos.io";
const SEED_WEBHOOK_ID = "wh_steadfast_default";

const results = [];
const out = (line) => process.stdout.write(`${line}\n`);

function forgeJwt(claims, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iat: now, exp: now + 3600, ...claims })}`;
  return `${unsigned}.${crypto.createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text(), setCookies: res.headers.getSetCookie(), retryAfter: res.headers.get("retry-after") };
}

function expectStatus(res, ...allowed) {
  if (!allowed.includes(res.status)) throw new Error(`expected HTTP ${allowed.join(" or ")}, got ${res.status}`);
  return `HTTP ${res.status}`;
}

async function check(id, name, fn) {
  try {
    const detail = await fn();
    results.push(true);
    out(`PASS  ${id.padEnd(4)} ${name}${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    results.push(false);
    out(`FAIL  ${id.padEnd(4)} ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sessionCookie(res, name) {
  const cookie = res.setCookies.find((c) => c.startsWith(`${name}=`));
  if (!cookie) throw new Error(`no ${name} cookie was set`);
  if (!/;\s*httponly/i.test(cookie)) throw new Error(`${name} cookie is not httpOnly`);
  return cookie.split(";")[0];
}

async function main() {
  out(`Phase 0 exploit replay against ${BASE_URL}\n`);

  // #1 · C1 — shared default passwords accepted for any account
  await check("1", "Tenant login with a shared default password is rejected", async () => {
    const codes = [];
    for (const password of SHARED_DEFAULT_PASSWORDS) {
      const res = await call("POST", "/api/v1/auth/login", { body: { email: SEED_OWNER_EMAIL, password } });
      expectStatus(res, 401);
      codes.push(res.status);
    }
    return `HTTP ${codes.join(", ")}`;
  });

  // #2 · C8 — platform login never checked the password
  await check("2", "Platform login with a wrong password is rejected", async () => {
    const res = await call("POST", "/api/v1/platform/auth/login", { body: { email: SEED_PLATFORM_EMAIL, password: "definitely-wrong-password" } });
    return expectStatus(res, 401);
  });

  // #3 · C2 — tenant JWT forged with the published default secret (old claims, then new issuer/audience)
  await check("3", "Tenant JWT forged with the published default secret is rejected", async () => {
    const claims = { userId: SEED_OWNER_ID, tenantId: SEED_TENANT_ID, role: "OWNER", email: SEED_OWNER_EMAIL, name: "Forged" };
    const legacy = await call("GET", "/api/v1/orders", { headers: { authorization: `Bearer ${forgeJwt(claims, PUBLISHED_DEFAULT_JWT_SECRET)}` } });
    expectStatus(legacy, 401);
    const withAudience = forgeJwt({ ...claims, iss: "commerceos", aud: "commerceos:tenant" }, PUBLISHED_DEFAULT_JWT_SECRET);
    const current = await call("GET", "/api/v1/orders", { headers: { cookie: `commerceos_session=${withAudience}` } });
    expectStatus(current, 401);
    return `HTTP ${legacy.status}, ${current.status}`;
  });

  // #4 · C2 — platform JWT forged with the published default secret
  await check("4", "Platform JWT forged with the published default secret is rejected", async () => {
    const token = forgeJwt(
      { userId: SEED_PLATFORM_ID, email: SEED_PLATFORM_EMAIL, platformRole: "SUPER_ADMIN", mfaVerified: true, iss: "commerceos", aud: "commerceos:platform" },
      PUBLISHED_DEFAULT_JWT_SECRET
    );
    const viaHeader = await call("GET", "/api/v1/platform/overview", { headers: { "x-platform-token": token } });
    expectStatus(viaHeader, 401);
    const viaCookie = await call("GET", "/api/v1/platform/tenants", { headers: { cookie: `commerceos_platform_session=${token}` } });
    expectStatus(viaCookie, 401);
    return `HTTP ${viaHeader.status}, ${viaCookie.status}`;
  });

  // #5 · C3 — legacy test header granted a platform role without a token
  await check("5", "Legacy platform role header without a token is rejected", async () => {
    const res = await call("GET", "/api/v1/platform/overview", { headers: { [LEGACY_ROLE_HEADER]: "SUPER_ADMIN" } });
    return expectStatus(res, 401);
  });

  // #6 · H1 — dev fallback identity for missing or invalid tokens
  await check("6", "Tenant API without a session, or with a garbage token, is rejected", async () => {
    const none = await call("GET", "/api/v1/orders");
    expectStatus(none, 401);
    const garbageBearer = await call("GET", "/api/v1/orders", { headers: { authorization: "Bearer not-a-real-token" } });
    expectStatus(garbageBearer, 401);
    const garbageCookie = await call("GET", "/api/v1/orders", { headers: { cookie: "commerceos_session=garbage" } });
    expectStatus(garbageCookie, 401);
    return `HTTP ${none.status}, ${garbageBearer.status}, ${garbageCookie.status}`;
  });

  // #7 · H10 — fake step-up accepted any 6 characters
  await check("7", "Step-up without a platform session is rejected", async () => {
    const res = await call("POST", "/api/v1/platform/auth/step-up", { body: { code: "zzzzzz" } });
    return expectStatus(res, 401);
  });

  // #9 · C4 — unsigned courier / payment webhooks
  const courierBody = JSON.stringify({ tracking_number: "TRK-SMOKE-NOT-REAL", status: "delivered" });
  await check("9a", "Unsigned courier webhook choosing its tenant by header/query is rejected", async () => {
    const res = await call("POST", `/api/v1/automation/webhooks/steadfast?tenant_id=${SEED_TENANT_ID}`, { headers: { "x-tenant-id": SEED_TENANT_ID }, body: courierBody });
    return expectStatus(res, 401);
  });
  await check("9b", "Unsigned courier webhook to a real endpoint id is rejected", async () => {
    const res = await call("POST", `/api/v1/automation/webhooks/steadfast?wh=${SEED_WEBHOOK_ID}`, { body: courierBody });
    return expectStatus(res, 401);
  });
  await check("9c", "An Authorization header does not replace the webhook signature", async () => {
    const res = await call("POST", `/api/v1/automation/webhooks/steadfast?wh=${SEED_WEBHOOK_ID}`, {
      headers: { authorization: "Bearer anything", "x-webhook-timestamp": Date.now().toString() },
      body: courierBody,
    });
    return expectStatus(res, 401);
  });
  await check("9d", "A made-up webhook signature is rejected", async () => {
    const res = await call("POST", `/api/v1/automation/webhooks/steadfast?wh=${SEED_WEBHOOK_ID}`, {
      headers: { "x-webhook-signature": crypto.randomBytes(32).toString("hex"), "x-webhook-timestamp": Date.now().toString() },
      body: courierBody,
    });
    return expectStatus(res, 401);
  });

  // H5 — social ingress
  await check("H5a", "Meta verify handshake with the old public verify token is refused", async () => {
    const challenge = `smoke-${crypto.randomUUID()}`;
    const res = await call("GET", `/api/v1/social/webhooks/facebook?hub.mode=subscribe&hub.verify_token=${LEGACY_META_VERIFY_TOKEN}&hub.challenge=${challenge}`);
    expectStatus(res, 403, 503);
    if (res.text.includes(challenge)) throw new Error("the challenge was echoed back");
    return `HTTP ${res.status}`;
  });
  await check("H5b", "Unsigned Meta webhook events are not processed", async () => {
    const payload = {
      object: "page",
      entry: [{ id: "smoke_page", time: Date.now(), messaging: [{ sender: { id: "smoke_psid" }, recipient: { id: "smoke_page" }, timestamp: Date.now(), message: { mid: `mid.smoke.${crypto.randomUUID()}`, text: "smoke" } }] }],
    };
    const res = await call("POST", "/api/v1/social/webhooks/facebook", { body: payload });
    expectStatus(res, 200); // Meta requires 200; the result must show nothing was processed
    const result = JSON.parse(res.text).result;
    if (!result || result.success !== false || result.messagesProcessed !== 0) throw new Error(`event was processed: ${res.text.slice(0, 200)}`);
    return "HTTP 200, 0 messages processed";
  });

  // ---- Phase 1 ----
  await check("P1-a", "A service-token-shaped bearer that isn't a real token is rejected", async () => {
    const res = await call("GET", "/api/v1/orders", { headers: { authorization: `Bearer cos_svc_${crypto.randomBytes(32).toString("base64url")}` } });
    return expectStatus(res, 401);
  });
  await check("P1-b", "Security headers are set", async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
    const missing = ["x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"].filter((h) => !res.headers.get(h));
    if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
    return `X-Frame-Options ${res.headers.get("x-frame-options")}`;
  });
  await check("P1-c", "Password guessing against one account is rate-limited (429 after 10 tries)", async () => {
    const email = `smoke-${crypto.randomUUID()}@nowhere.test`;
    let last;
    for (let i = 0; i < 11; i++) last = await call("POST", "/api/v1/auth/login", { body: { email, password: `guess-${i}` } });
    expectStatus(last, 429);
    if (!last.retryAfter) throw new Error("no Retry-After header");
    return `11th attempt HTTP ${last.status}, Retry-After ${last.retryAfter}s`;
  });

  // Positive checks: real sign-in still works
  const { SMOKE_TENANT_EMAIL, SMOKE_TENANT_PASSWORD, SMOKE_PLATFORM_EMAIL, SMOKE_PLATFORM_PASSWORD } = process.env;
  if (SMOKE_TENANT_EMAIL && SMOKE_TENANT_PASSWORD) {
    await check("P1", "A real workspace sign-in works and its session reads data", async () => {
      const login = await call("POST", "/api/v1/auth/login", { body: { email: SMOKE_TENANT_EMAIL, password: SMOKE_TENANT_PASSWORD } });
      expectStatus(login, 200);
      const cookie = sessionCookie(login, "commerceos_session");
      const orders = await call("GET", "/api/v1/orders?limit=1", { headers: { cookie } });
      expectStatus(orders, 200);
      // Phase 1 (H4): unknown fields such as tenant_id are rejected, not merged.
      const massAssign = await call("PATCH", "/api/v1/customers/cus_smoke_missing", { headers: { cookie }, body: { tenant_id: "ten_other", total_spent: 1 } });
      expectStatus(massAssign, 400, 404);
      return `login ${login.status}, orders ${orders.status}, mass-assignment PATCH ${massAssign.status}`;
    });
  }
  if (SMOKE_PLATFORM_EMAIL && SMOKE_PLATFORM_PASSWORD) {
    await check("P2", "A real platform sign-in works; the token is only in an httpOnly cookie; step-up needs an authenticator", async () => {
      const login = await call("POST", "/api/v1/platform/auth/login", { body: { email: SMOKE_PLATFORM_EMAIL, password: SMOKE_PLATFORM_PASSWORD } });
      expectStatus(login, 200);
      const body = JSON.parse(login.text);
      if (body?.token !== undefined || body?.data?.token !== undefined) throw new Error("the login response body contains a token");
      const cookie = sessionCookie(login, "commerceos_platform_session");
      const session = await call("GET", "/api/v1/platform/auth/session", { headers: { cookie } });
      expectStatus(session, 200);
      const stepUp = await call("POST", "/api/v1/platform/auth/step-up", { headers: { cookie }, body: { code: "123456" } });
      expectStatus(stepUp, 409); // MFA_NOT_ENROLLED until the operator sets up TOTP (FX-15)
      return `login ${login.status}, session ${session.status}, step-up ${stepUp.status}`;
    });
  }

  if (process.env.SMOKE_WEBHOOK_SECRET) {
    const webhookId = process.env.SMOKE_WEBHOOK_ID || SEED_WEBHOOK_ID;
    await check("P3", "A correctly signed courier webhook is accepted", async () => {
      const timestamp = Date.now().toString();
      const signature = crypto.createHmac("sha256", process.env.SMOKE_WEBHOOK_SECRET).update(`${timestamp}.${courierBody}`).digest("hex");
      const res = await call("POST", `/api/v1/automation/webhooks/steadfast?wh=${webhookId}`, {
        headers: { "x-webhook-signature": signature, "x-webhook-timestamp": timestamp },
        body: courierBody,
      });
      expectStatus(res, 200);
      if (JSON.parse(res.text).verified !== true) throw new Error("response is not verified:true");
      return "HTTP 200, verified";
    });
  }

  const failed = results.filter((ok) => !ok).length;
  out(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`Smoke run aborted: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
