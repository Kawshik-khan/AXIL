/**
 * Post-deploy smoke test (production readiness R5). Sends requests only; prints status codes, never tokens or passwords.
 *
 *   BASE_URL=https://<service>.onrender.com \
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-deploy.mjs
 *
 * Checks: liveness, the full readiness endpoint (store, Postgres, and every required external service), then one
 * critical user flow on a dedicated smoke workspace: sign in, list orders, list products, sign out. It is read-only
 * after sign-in so it never creates orders or moves stock in a live database. WAIT_SECONDS (default 300) is how long to
 * keep retrying while the new version starts. Exit code 1 on any failure.
 */
const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const WAIT_MS = Number(process.env.WAIT_SECONDS || 300) * 1000;
if (!BASE) {
  console.error("BASE_URL is required");
  process.exit(2);
}

const results = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${err.message}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path, headers = {}) => fetch(`${BASE}${path}`, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });

async function waitFor(path) {
  const deadline = Date.now() + WAIT_MS;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const res = await get(path);
      if (res.status === 200) return res;
      last = `HTTP ${res.status}`;
      const body = await res.json().catch(() => null);
      if (body?.reason) last += ` ${body.reason}`;
    } catch (err) {
      last = err.name;
    }
    await sleep(10_000);
  }
  throw new Error(`${path} was not healthy within ${WAIT_MS / 1000}s (${last})`);
}

await step("liveness /health", async () => {
  await waitFor("/health");
});
await step("readiness /health/ready (full)", async () => {
  const res = await waitFor("/health/ready");
  const body = await res.json();
  if (body.status !== "ready") throw new Error(`status ${body.status}`);
  return Object.entries(body.checks?.dependencies ?? {}).map(([k, v]) => `${k}:${v.state}`).join(" ");
});

if (EMAIL && PASSWORD) {
  let cookie = "";
  await step("sign in to the smoke workspace", async () => {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("no session cookie");
  });
  for (const path of ["/api/v1/orders?limit=1", "/api/v1/products?limit=1"]) {
    await step(`GET ${path}`, async () => {
      const res = await get(path, { cookie });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.success === false) throw new Error("success=false");
    });
  }
  await step("sign out", async () => {
    const res = await fetch(`${BASE}/api/v1/auth/logout`, { method: "POST", headers: { cookie }, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  });
} else {
  console.log("SKIP critical flow: SMOKE_EMAIL / SMOKE_PASSWORD not set");
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
