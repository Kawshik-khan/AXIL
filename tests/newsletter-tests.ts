/**
 * Public landing-page newsletter sign-up (POST /api/v1/public/newsletter).
 * Real route handler, the JSON store (or Postgres with COMMERCEOS_TEST_PG=1).
 * Run: node tests/ts-runner.cjs ./tests/newsletter-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";
import { POST } from "@/app/api/v1/public/newsletter/route";

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
    console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    failed++;
  }
}

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

async function subscribe(body: unknown, headers: Record<string, string> = {}) {
  const response = await POST(
    new Request("http://localhost:3000/api/v1/public/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  const parsed = (text ? JSON.parse(text) : {}) as Envelope;
  return { status: response.status, body: parsed, text };
}

const uniqueEmail = (label: string) => `reader_${label}_${crypto.randomUUID().slice(0, 8)}@newsletter.test`;
const countFor = (email: string) => db.getAllNewsletterSubscriptions().filter((s) => s.email === email).length;

async function main() {
  console.log(`\n${BOLD}   COMMERCEOS NEWSLETTER SIGN-UP   ${RESET}\n`);
  await (db as unknown as { ready?: () => Promise<void> }).ready?.();
  delete process.env.TRUST_PROXY;
  resetRateLimitsForTesting();

  await runTest("a new consented address is stored once, normalised, and answered with 202 subscribed", async () => {
    const email = uniqueEmail("new");
    const res = await subscribe({ email: `  ${email.toUpperCase()}  `, consent: true });
    assert.strictEqual(res.status, 202, res.text);
    assert.deepStrictEqual(res.body.data, { status: "subscribed" });
    const stored = db.findNewsletterSubscriptionByEmail(email);
    assert.ok(stored, "record stored under the trimmed, lowercased email");
    assert.strictEqual(stored.source, "landing");
    assert.ok(stored.id.startsWith("nls_"));
    assert.ok(!Number.isNaN(Date.parse(stored.consented_at)) && !Number.isNaN(Date.parse(stored.created_at)));
    assert.deepStrictEqual(Object.keys(stored).sort(), ["consented_at", "created_at", "email", "id", "source"]);
  });

  await runTest("the response never echoes the email or the record id", async () => {
    const email = uniqueEmail("echo");
    const res = await subscribe({ email, consent: true });
    assert.strictEqual(res.status, 202, res.text);
    const stored = db.findNewsletterSubscriptionByEmail(email);
    assert.ok(stored);
    assert.ok(!res.text.toLowerCase().includes(email), "email not in the response body");
    assert.ok(!res.text.includes(stored.id), "record id not in the response body");
    assert.ok(!res.text.includes("@"), "no address-like text in the response");
  });

  await runTest("a duplicate (any case or spacing) answers the same 202 and leaves exactly one record", async () => {
    const email = uniqueEmail("dup");
    const first = await subscribe({ email, consent: true });
    const consentedAt = db.findNewsletterSubscriptionByEmail(email)?.consented_at;
    const second = await subscribe({ email: ` ${email.toUpperCase()} `, consent: true });
    assert.strictEqual(first.status, 202);
    assert.strictEqual(second.status, 202);
    assert.deepStrictEqual(second.body.data, first.body.data, "a known address is indistinguishable from a new one");
    assert.deepStrictEqual(Object.keys(second.body).sort(), Object.keys(first.body).sort());
    assert.strictEqual(countFor(email), 1);
    assert.strictEqual(db.findNewsletterSubscriptionByEmail(email)?.consented_at, consentedAt, "original consent time kept");
  });

  await runTest("an extra key is rejected with 400 and nothing is stored", async () => {
    const email = uniqueEmail("extra");
    const res = await subscribe({ email, consent: true, source: "admin" });
    assert.strictEqual(res.status, 400, res.text);
    assert.strictEqual(res.body.data, undefined);
    assert.strictEqual(countFor(email), 0);
    const tenant = await subscribe({ email, consent: true, tenant_id: "tenant_x" });
    assert.strictEqual(tenant.status, 400, tenant.text);
    assert.strictEqual(countFor(email), 0);
  });

  await runTest("a bad, missing or over-long email is rejected with 400", async () => {
    for (const email of ["not-an-email", "", "a@", 42, null, `${"a".repeat(250)}@x.test`]) {
      const res = await subscribe({ email, consent: true });
      assert.strictEqual(res.status, 400, `${JSON.stringify(email)}: ${res.text}`);
    }
    assert.strictEqual((await subscribe({ consent: true })).status, 400, "missing email");
    assert.strictEqual((await subscribe("{not json")).status, 400, "malformed body");
  });

  await runTest("missing or non-true consent is rejected with 400 and nothing is stored", async () => {
    const email = uniqueEmail("consent");
    for (const body of [{ email }, { email, consent: false }, { email, consent: "true" }, { email, consent: 1 }, { email, consent: null }]) {
      const res = await subscribe(body);
      assert.strictEqual(res.status, 400, `${JSON.stringify(body)}: ${res.text}`);
    }
    assert.strictEqual(countFor(email), 0);
  });

  await runTest("a non-JSON content type (cross-site text/plain or form post) is rejected with 415 and nothing is stored", async () => {
    const email = uniqueEmail("ctype");
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await subscribe({ email, consent: true }, { "content-type": type });
      assert.strictEqual(res.status, 415, `${type}: ${res.text}`);
    }
    assert.strictEqual((await subscribe({ email, consent: true }, { "content-type": "application/json; charset=utf-8" })).status, 202);
    assert.strictEqual(countFor(email), 1);
  });

  await runTest("an email over 254 characters after trimming is rejected with 400", async () => {
    const res = await subscribe({ email: `  ${"b".repeat(248)}@x.test  `, consent: true });
    assert.strictEqual(res.status, 400, res.text);
  });

  await runTest("per-client limit: the 6th sign-up in an hour from one client gets 429; another client is unaffected", async () => {
    resetRateLimitsForTesting();
    process.env.TRUST_PROXY = "1";
    try {
      const client = { "x-forwarded-for": "203.0.113.7" };
      for (let i = 0; i < 5; i++) {
        const res = await subscribe({ email: uniqueEmail(`rl${i}`), consent: true }, client);
        assert.strictEqual(res.status, 202, `request ${i + 1}: ${res.text}`);
      }
      const blockedEmail = uniqueEmail("blocked");
      const blocked = await subscribe({ email: blockedEmail, consent: true }, client);
      assert.strictEqual(blocked.status, 429, blocked.text);
      assert.strictEqual(blocked.body.error?.code, "RATE_LIMITED");
      assert.strictEqual(countFor(blockedEmail), 0, "a limited request stores nothing");
      const other = await subscribe({ email: uniqueEmail("other"), consent: true }, { "x-forwarded-for": "203.0.113.8" });
      assert.strictEqual(other.status, 202, other.text);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  await runTest("global cap: after 200 requests in an hour every caller gets 429, with or without a client key", async () => {
    resetRateLimitsForTesting();
    for (let i = 0; i < 200; i++) {
      const res = await subscribe({ email: "x", consent: true }); // invalid bodies still count against the cap
      assert.strictEqual(res.status, 400, `request ${i + 1}: ${res.text}`);
    }
    const blocked = await subscribe({ email: uniqueEmail("cap"), consent: true });
    assert.strictEqual(blocked.status, 429, blocked.text);
    process.env.TRUST_PROXY = "1";
    try {
      const fresh = await subscribe({ email: uniqueEmail("cap2"), consent: true }, { "x-forwarded-for": "198.51.100.9" });
      assert.strictEqual(fresh.status, 429, "a new client key does not lift the global cap");
    } finally {
      delete process.env.TRUST_PROXY;
    }
    resetRateLimitsForTesting();
  });

  console.log(`\n${BOLD}Results: ${passed} passed, ${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
