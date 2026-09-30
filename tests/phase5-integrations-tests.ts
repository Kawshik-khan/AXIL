/**
 * Phase 5, stage 1 (FIX_IMPLEMENTATION_PLAN FX-53, FX-54, FX-55; audit M17; ADR-110): the SSRF-guarded outbound
 * client, live connector checks, real signed enterprise webhooks with retries and dead-lettering, and signed n8n calls.
 * Network tests use a local HTTP receiver on 127.0.0.1 (allow-listed); provider checks use a stubbed transport. No
 * request leaves this machine.
 * Run: node tests/ts-runner.cjs ./tests/phase5-integrations-tests.ts
 */
import assert from "assert";
import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { runLiveCheck } from "@/domains/connectors/live-checks";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { N8nProviderService } from "@/domains/automation/services/n8n-provider.service";
import {
  OutboundBlockedError,
  OutboundNetworkError,
  OutboundTimeoutError,
  assertSafeUrl,
  isBlockedAddress,
  outboundRequest,
  parseSafeUrl,
  setOutboundLookupForTesting,
  setOutboundTransportForTesting,
} from "@/lib/outbound-http";
import { verifyOutboundSignature } from "@/lib/outbound-signing";
import { logger } from "@/lib/logger";
import { OpenAICompatibleProvider } from "@/domains/ai/providers/openai-compatible.provider";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import type { CommerceEvent } from "@/types/commerce";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_RESET = "\x1b[0m";
let passed = 0;
let failed = 0;
const out = (line: string) => process.stdout.write(`${line}\n`);

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    out(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${name}`);
  } catch (err) {
    failed++;
    out(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${name}`);
    out(`      ${(err as Error).stack ?? String(err)}`);
  }
}

interface Received {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A local receiver: records requests; `respond` decides each answer. */
async function receiver(respond: (req: Received, res: http.ServerResponse) => void) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const r = { path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      received.push(r);
      respond(r, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const ROOT = path.resolve(__dirname, "..");
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;
const nowIso = () => new Date().toISOString();

async function main() {
  // ---------------------------------------------------------------------------
  out(`\n${ANSI_BOLD}[SSRF guard] Addresses and URLs${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  await runTest("private, loopback, link-local, CGNAT, multicast and reserved addresses are refused; public ones pass", () => {
    const refused = [
      "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "240.0.0.1", "255.255.255.255", "198.18.0.1",
      "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1",
    ];
    for (const a of refused) assert.strictEqual(isBlockedAddress(a), true, `${a} must be refused`);
    for (const a of ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      assert.strictEqual(isBlockedAddress(a), false, `${a} is public`);
    }
    assert.strictEqual(isBlockedAddress("not-an-ip"), true);
  });

  await runTest("URLs: only https, no credentials, no private literals or local names (also in decimal/hex forms)", () => {
    for (const bad of [
      "ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.com",
      "http://example.com/x", "https://user:pass@example.com/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest",
      "https://2130706433/", "https://0x7f000001/", "https://localhost:3000/", "https://db.internal/", "https://printer.local/", "not a url",
    ]) {
      assert.throws(() => parseSafeUrl(bad), OutboundBlockedError, bad);
    }
    assert.strictEqual(parseSafeUrl("https://hooks.example.com/in?x=1").hostname, "hooks.example.com");
  });

  await runTest("review follow-ups: IPv4-translated IPv6, trailing-dot names, a DNS server that never answers", async () => {
    assert.strictEqual(isBlockedAddress("::ffff:0:7f00:1"), true);
    assert.throws(() => parseSafeUrl("https://[::ffff:0:127.0.0.1]/"), OutboundBlockedError);
    assert.throws(() => parseSafeUrl("https://localhost./"), OutboundBlockedError);
    assert.throws(() => parseSafeUrl("https://metadata.google.internal./"), OutboundBlockedError);
    setOutboundLookupForTesting(() => new Promise(() => undefined));
    try {
      const started = Date.now();
      await assert.rejects(assertSafeUrl("https://slow-dns.example.com/"), OutboundBlockedError);
      assert.ok(Date.now() - started < 4_500, "gives up after the DNS deadline");
    } finally {
      setOutboundLookupForTesting(null);
    }
  });

  await runTest("a host name that resolves to a private address is refused at save time", async () => {
    setOutboundLookupForTesting(async (host) => (host === "evil.example.com" ? [{ address: "10.0.0.7", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]));
    try {
      await assert.rejects(assertSafeUrl("https://evil.example.com/hook"), OutboundBlockedError);
      assert.ok(await assertSafeUrl("https://good.example.com/hook"));
    } finally {
      setOutboundLookupForTesting(null);
    }
  });

  await runTest("DNS rebinding: an answer that turns private after the check is refused when connecting", async () => {
    let calls = 0;
    // First answer public (the save-time check), then private (the connection)
    setOutboundLookupForTesting(async () => (calls++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]));
    try {
      await assertSafeUrl("https://rebind.example.com/x");
      await assert.rejects(outboundRequest("https://rebind.example.com/x", { timeoutMs: 2000 }), OutboundBlockedError);
      // A mixed answer (one public, one private) is refused as a whole
      setOutboundLookupForTesting(async () => [{ address: "93.184.216.34", family: 4 }, { address: "192.168.0.10", family: 4 }]);
      await assert.rejects(outboundRequest("https://mixed.example.com/x", { timeoutMs: 2000 }), OutboundBlockedError);
    } finally {
      setOutboundLookupForTesting(null);
    }
  });

  // ---------------------------------------------------------------------------
  out(`\n${ANSI_BOLD}[Outbound client] Allow-list, redirects, limits, errors${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const local = await receiver((req, res) => {
    if (req.path.startsWith("/redirect")) {
      res.writeHead(302, { location: "/elsewhere" });
      res.end();
    } else if (req.path.startsWith("/slow")) {
      setTimeout(() => res.end("late"), 1500);
    } else if (req.path.startsWith("/big")) {
      res.end("x".repeat(200_000));
    } else {
      res.end(JSON.stringify({ ok: true, path: req.path }));
    }
  });
  const base = `http://127.0.0.1:${local.port}`;
  const savedAllow = process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS;

  await runTest("a private host is reachable only when the platform allow-list names its host:port", async () => {
    delete process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS;
    await assert.rejects(outboundRequest(`${base}/ok`), OutboundBlockedError);
    process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${local.port}`;
    const res = await outboundRequest(`${base}/ok`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('"ok":true'));
    // Another port on the same host is not allowed
    await assert.rejects(outboundRequest(`http://127.0.0.1:${local.port + 1}/ok`), OutboundBlockedError);
  });

  await runTest("redirects are never followed (a 302 is returned as it is)", async () => {
    const before = local.received.length;
    const res = await outboundRequest(`${base}/redirect`);
    assert.strictEqual(res.status, 302);
    assert.strictEqual(local.received.length, before + 1, "the redirect target was not requested");
  });

  await runTest("the deadline and the response size cap apply", async () => {
    await assert.rejects(outboundRequest(`${base}/slow`, { timeoutMs: 200 }), OutboundTimeoutError);
    const big = await outboundRequest(`${base}/big`, { maxResponseBytes: 1000 });
    assert.strictEqual(big.truncated, true);
    assert.strictEqual(big.body.length, 1000);
  });

  await runTest("errors name the host only: no path, query, headers or body (they can carry keys)", async () => {
    process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${local.port},127.0.0.1:1`;
    const err = await outboundRequest("http://127.0.0.1:1/v1/models?key=SECRET-IN-QUERY", { headers: { Authorization: "Bearer SECRET-HEADER" } }).then(
      () => null,
      (e: unknown) => e
    );
    assert.ok(err instanceof OutboundNetworkError);
    assert.ok(!/SECRET/.test((err as Error).message));
    process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${local.port}`;
  });

  await runTest("an unreachable AI provider fails without naming its (possibly internal) host", async () => {
    const provider = new OpenAICompatibleProvider({ baseUrl: "http://ollama.internal.p5:11434/v1", name: "p5-llm", models: { TIER_1_FAST: "m", TIER_2_REASONING: "m", TIER_3_EMBEDDING: "e" } });
    setOutboundTransportForTesting(async (url) => {
      throw new OutboundNetworkError(url.hostname, "ECONNREFUSED");
    });
    try {
      const err = await provider.chat([{ role: "user", content: "hi" }]).then(() => null, (e: unknown) => e as Error & { code?: string });
      assert.strictEqual(err?.code, "LLM_PROVIDER_ERROR");
      assert.ok(!/ollama\.internal|ECONNREFUSED/.test(String(err?.message)));
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("the logger replaces credential-like string values, keeps ids and counts", () => {
    const writes: string[] = [];
    const real = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      writes.push(s);
      return true;
    };
    try {
      logger.info("p5.redaction", {
        api_key: "sk-live-123",
        nested: { authorization: "Bearer abc", password: "pw" },
        service_token_id: "st_1",
        input_tokens: 42,
        secret_reference: "MY_ENV",
        authorization_status: "GRANTED",
        at: new Date("2026-09-30T00:00:00.000Z"),
        error: "request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y and key sk-proj-ABCDEFGH123",
        deep: { a: { b: { c: { d: { e: { token: "deep-token-value" } } } } } },
        database_url: "postgres://user:pw@host/db",
      });
    } finally {
      (process.stdout as unknown as { write: typeof real }).write = real;
    }
    const line = writes.join("");
    assert.ok(!line.includes("sk-live-123") && !line.includes("Bearer abc") && !line.includes('"pw"'));
    assert.ok(line.includes("[REDACTED]"));
    assert.ok(line.includes("st_1") && line.includes("42") && line.includes("MY_ENV"));
    assert.ok(line.includes("GRANTED"), "a *_status value is not a secret");
    assert.ok(line.includes("2026-09-30T00:00:00.000Z"), "dates stay readable");
    assert.ok(!line.includes("eyJhbGciOiJIUzI1NiJ9") && !line.includes("sk-proj-ABCDEFGH123"), "credentials inside free text");
    assert.ok(!line.includes("deep-token-value"), "deeply nested");
    assert.ok(!line.includes("user:pw@host"), "connection strings");
  });

  // ---------------------------------------------------------------------------
  out(`\n${ANSI_BOLD}[FX-53] Live connector checks${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  let answer = { status: 200, body: "{}" };
  setOutboundTransportForTesting(async (url, options) => {
    seen.push({ url: url.toString(), headers: options.headers ?? {} });
    return { status: answer.status, headers: {}, body: answer.body, truncated: false, durationMs: 7 };
  });
  const check = (providerId: string, credentials: Record<string, unknown>, endpoint?: string, defaultEndpoint?: string) =>
    runLiveCheck({ providerId, providerName: providerId, credentials, endpoint, defaultEndpoint });

  await runTest("each provider's auth check calls its documented endpoint with its auth header", async () => {
    const cases: Array<[string, Record<string, unknown>, string, string, string | undefined]> = [
      ["anthropic", { api_key: "sk-ant-3344" }, "https://api.anthropic.com/v1/models?limit=1", "x-api-key", "https://api.anthropic.com/v1"],
      ["google_gemini", { api_key: "AIza-gem-5521" }, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", "x-goog-api-key", undefined],
      ["openai", { api_key: "sk-oai-6655" }, "https://api.openai.com/v1/models", "Authorization", "https://api.openai.com/v1"],
      ["meta_graph", { page_access_token: "EAAB" }, "https://graph.facebook.com/me?fields=id", "Authorization", undefined],
      ["whatsapp_cloud", { phone_number_id: "1234567890", permanent_access_token: "EAAW" }, "https://graph.facebook.com/1234567890?fields=id", "Authorization", undefined],
      ["steadfast", { api_key: "sf-key-4411", secret_key: "sf-secret-9922" }, "https://portal.packzy.com/api/v1/get_balance", "Secret-Key", undefined],
      ["pinecone", { api_key: "pcsk_pine_2211" }, "https://api.pinecone.io/indexes", "Api-Key", undefined],
      ["upstash_redis", { rest_url: "https://eu1-x.upstash.io", rest_token: "up-token-7788" }, "https://eu1-x.upstash.io/ping", "Authorization", undefined],
      ["prov_hubspot_crm", { access_token: "pat-1" }, "https://api.hubapi.com/account-info/v3/details", "Authorization", undefined],
      ["prov_shopify_plus", { shop_domain: "my-store.myshopify.com", access_token: "shpat" }, "https://my-store.myshopify.com/admin/api/2025-07/shop.json", "X-Shopify-Access-Token", undefined],
    ];
    for (const [id, creds, url, header, def] of cases) {
      seen.length = 0;
      const r = await check(id, creds, undefined, def);
      assert.ok(r, `${id} has a live check`);
      assert.strictEqual(r.status, "VERIFIED", id);
      assert.strictEqual(r.latency_ms, 7);
      assert.strictEqual(seen[0]?.url, url, id);
      assert.ok(seen[0].headers[header], `${id} sends ${header}`);
      assert.ok(!JSON.stringify(r).includes(String(Object.values(creds).at(-1))), `${id}: no credential in the result`);
    }
  });

  await runTest("refusals are classified (401 → UNAUTHORIZED, 404, 429, 5xx) and never echo the provider's body", async () => {
    for (const [status, reason] of [[401, "UNAUTHORIZED"], [403, "UNAUTHORIZED"], [404, "NOT_FOUND"], [429, "RATE_LIMITED"], [503, "PROVIDER_ERROR"]] as const) {
      answer = { status, body: '{"error":"account acct_998 suspended, contact billing@provider"}' };
      const r = await check("pinecone", { api_key: "pcsk_1" });
      assert.strictEqual(r?.status, "FAILED");
      assert.strictEqual(r?.details?.reason, reason);
      assert.ok(!JSON.stringify(r).includes("acct_998"));
    }
    answer = { status: 200, body: "{}" };
  });

  await runTest("bad input is refused before any request; providers without a check return null (NOT_VERIFIED)", async () => {
    seen.length = 0;
    assert.strictEqual((await check("prov_shopify_plus", { shop_domain: "evil.com", access_token: "x" }))?.details?.reason, "INVALID_INPUT");
    assert.strictEqual((await check("whatsapp_cloud", { phone_number_id: "../me", permanent_access_token: "x" }))?.details?.reason, "INVALID_INPUT");
    assert.strictEqual((await check("telegram", { bot_token: "nope" }))?.details?.reason, "INVALID_INPUT");
    assert.strictEqual(seen.length, 0);
    assert.strictEqual(await check("neon", { connection_uri: "postgres://x" }), null);
  });

  await runTest("a tenant's URL: obvious private URLs say BLOCKED_URL; everything after the URL check reads the same (no probing oracle)", async () => {
    // Private literals, local names, http and odd ports are refused before any request
    for (const endpoint of ["http://localhost:11434/v1", "https://10.0.0.5/v1", "https://api.example.com:22/v1"]) {
      const r = await check("ollama", {}, endpoint);
      assert.strictEqual(r?.details?.reason, "BLOCKED_URL", endpoint);
      assert.ok(!r?.message.includes("OUTBOUND_ALLOWED_PRIVATE_HOSTS"), "tenants are not told about the platform allow-list");
    }
    // A timeout, a name that doesn't exist and a name that resolves to a private address are indistinguishable
    setOutboundTransportForTesting(async (url) => {
      throw new OutboundTimeoutError(url.hostname, 5000);
    });
    const timeout = await check("anthropic", { api_key: "k-timeout-1" }, undefined, "https://api.anthropic.com/v1");
    setOutboundTransportForTesting(null);
    setOutboundLookupForTesting(async (host) => {
      if (host === "internal-only.example.com") return [{ address: "10.1.2.3", family: 4 }];
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    });
    try {
      const privateName = await check("qdrant", { endpoint_url: "https://internal-only.example.com" });
      const missingName = await check("qdrant", { endpoint_url: "https://does-not-exist.example.com" });
      for (const r of [timeout, privateName, missingName]) {
        assert.strictEqual(r?.details?.reason, "UNREACHABLE");
        assert.strictEqual(r?.message, (timeout as { message: string }).message.replace("anthropic", r?.message.split(":")[0] ?? ""));
      }
      assert.ok(!/ENOTFOUND|10\.1\.2\.3|internal-only/.test(JSON.stringify([privateName, missingName])));
    } finally {
      setOutboundLookupForTesting(null);
    }
  });

  await runTest("the platform allow-list never applies to a tenant's URL", async () => {
    process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${local.port}`;
    const before = local.received.length;
    const r = await check("qdrant", { endpoint_url: `http://127.0.0.1:${local.port}` });
    assert.strictEqual(r?.details?.reason, "BLOCKED_URL");
    await assert.rejects(outboundRequest(`${base}/ok`, { tenantSupplied: true }), OutboundBlockedError);
    assert.strictEqual(local.received.length, before, "nothing reached the allow-listed host");
  });
  setOutboundTransportForTesting(null);

  // ---------------------------------------------------------------------------
  out(`\n${ANSI_BOLD}[FX-54] Enterprise webhooks delivered for real${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const workspace = async (label: string) => {
    const shop = await AuthService.registerTenantWithOwner({
      email: `${uid(label)}@phase5.test`,
      password: "Phase5-Owner-Pass-7713!",
      name: `Phase 5 ${label}`,
      workspaceName: `Phase 5 ${label} ${Date.now()}`,
    });
    const orgId = uid(`org_${label}`);
    db.createOrganization({
      id: orgId, tenant_id: shop.tenant.id, name: `${label} Holdings`, slug: orgId, legal_name: `${label} Ltd.`, default_currency: "BDT",
      supported_currencies: ["BDT"], headquarters_country: "Bangladesh", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso(),
    });
    return { shop, tenantId: shop.tenant.id, orgId };
  };
  const { shop, tenantId, orgId } = await workspace("p5");
  const other = await workspace("other");
  const otherOrg = other.orgId;

  // Webhook targets are tenant URLs: never private, never allow-listed. They use a public-looking name here, and the
  // transport forwards each request to a local receiver, so the real request (headers, body, signature) is checked.
  let hookStatus = 200;
  let hookDelayMs = 0;
  const hooks = await receiver((_req, res) => {
    setTimeout(() => {
      res.writeHead(hookStatus);
      res.end("ok");
    }, hookDelayMs);
  });
  setOutboundLookupForTesting(async () => [{ address: "93.184.216.34", family: 4 }]);
  setOutboundTransportForTesting(
    (url, options) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const req = http.request({ host: "127.0.0.1", port: hooks.port, path: `${url.pathname}${url.search}`, method: options.method, headers: options.headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: false, durationMs: Date.now() - started }));
        });
        req.on("error", reject);
        if (options.body) req.write(options.body);
        req.end();
      })
  );
  const hookUrl = "https://hooks.p5.example.com/hook";
  const event = (type: string, payload: Record<string, unknown> = {}, forTenant = tenantId): CommerceEvent =>
    db.recordEvent({ id: uid("evt"), type, version: "1", tenant_id: forTenant, aggregate_type: "order", aggregate_id: uid("ord"), timestamp: nowIso(), payload });
  const later = (ms: number) => new Date(Date.now() + ms);

  const sub = await webhookPlatformService.subscribe(orgId, { targetUrl: hookUrl, eventTypes: ["order.created", "shipment.updated"] });
  await new Promise((r) => setTimeout(r, 5)); // events after the subscription

  await runTest("the signing secret is returned once and stored encrypted", () => {
    assert.ok(sub.secret.startsWith("whsec_"));
    const stored = db.findEnterpriseWebhook(orgId, sub.id);
    assert.ok(stored && !stored.secret.startsWith("whsec_") && !stored.secret.includes(sub.secret), "encrypted at rest");
  });

  await runTest("unsafe targets are refused at subscribe (private, http, odd port, metadata, allow-listed, bad event types)", async () => {
    setOutboundLookupForTesting(async (host) => (host === "resolves-private.example.com" ? [{ address: "192.168.1.9", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]));
    try {
      for (const target of [
        "https://10.0.0.1/x", "http://hooks.example.com/x", "https://hooks.example.com:22/x", "https://169.254.169.254/",
        "https://resolves-private.example.com/x", `http://127.0.0.1:${local.port}/x`, "https://localhost./x",
      ]) {
        await assert.rejects(webhookPlatformService.subscribe(orgId, { targetUrl: target, eventTypes: ["order.created"] }), OutboundBlockedError, target);
      }
      await assert.rejects(webhookPlatformService.subscribe(orgId, { targetUrl: hookUrl, eventTypes: ["Order Created!"] }), /Event types/);
    } finally {
      setOutboundLookupForTesting(async () => [{ address: "93.184.216.34", family: 4 }]);
    }
  });

  await runTest("a commerce event becomes one signed delivery; the receiver can verify it; nothing is sent twice", async () => {
    const e = event("order.created", { order_number: "P5-1", total: 1500 });
    event("payment.completed"); // not subscribed
    event("order.created", {}, other.tenantId); // another workspace's event
    const run = await webhookPlatformService.runOnce();
    assert.strictEqual(run.queued, 1, "only this workspace's subscribed event");
    assert.strictEqual(run.delivered, 1);
    const got = hooks.received.at(-1);
    assert.ok(got);
    assert.strictEqual(got.headers["x-commerceos-event-id"], e.id);
    assert.strictEqual(got.headers["x-commerceos-event-type"], "order.created");
    assert.ok(verifyOutboundSignature(sub.secret, got.body, String(got.headers["x-commerceos-timestamp"]), String(got.headers["x-commerceos-signature"])), "signature verifies with the secret");
    assert.ok(!verifyOutboundSignature("whsec_wrong", got.body, String(got.headers["x-commerceos-timestamp"]), String(got.headers["x-commerceos-signature"])));
    const envelope = JSON.parse(got.body) as { event_id: string; organization_id: string; data: { order_number: string } };
    assert.strictEqual(envelope.event_id, e.id);
    assert.strictEqual(envelope.organization_id, orgId);
    assert.strictEqual(envelope.data.order_number, "P5-1");
    const [delivery] = webhookPlatformService.listDeliveries(orgId, sub.id);
    assert.strictEqual(delivery.status, "DELIVERED");
    assert.strictEqual(delivery.http_status, 200);
    assert.strictEqual((delivery as Record<string, unknown>).payload_json, undefined, "history carries no payload");
    const again = await webhookPlatformService.runOnce();
    assert.strictEqual(again.queued + again.attempted, 0, "no duplicate delivery");
    const audit = db.getAuditLogsByTenant(tenantId, 200).logs.filter((l) => l.action.startsWith("webhook."));
    assert.strictEqual(audit.length, 0, "service calls without an actor write no audit entry (routes pass one)");
  });

  await runTest("a failing receiver: retries with backoff, then dead-letter; a manual retry delivers", async () => {
    db.updateEnterpriseWebhook(orgId, sub.id, { retry_count_max: 3 });
    hookStatus = 500;
    event("shipment.updated", { status: "IN_TRANSIT" });
    let run = await webhookPlatformService.runOnce();
    assert.strictEqual(run.failed, 1);
    let d = webhookPlatformService.listDeliveries(orgId, sub.id)[0];
    assert.strictEqual(d.status, "RETRY_SCHEDULED");
    assert.strictEqual(d.last_error, "HTTP_500");
    assert.ok(d.next_attempt_at && d.next_attempt_at > nowIso(), "the next attempt is in the future");
    run = await webhookPlatformService.runOnce();
    assert.strictEqual(run.attempted, 0, "not before its time");
    await webhookPlatformService.runOnce({ now: later(10 * 60_000) });
    await webhookPlatformService.runOnce({ now: later(24 * 3_600_000) });
    d = webhookPlatformService.listDeliveries(orgId, sub.id)[0];
    assert.strictEqual(d.status, "DEAD_LETTERED");
    assert.strictEqual(d.attempt_number, 3);
    hookStatus = 200;
    webhookPlatformService.retryDelivery(orgId, d.id, { tenantId, userId: shop.user.id });
    run = await webhookPlatformService.runOnce();
    assert.strictEqual(run.delivered, 1);
    assert.strictEqual(webhookPlatformService.listDeliveries(orgId, sub.id)[0].status, "DELIVERED");
    assert.ok(db.getAuditLogsByTenant(tenantId, 200).logs.some((l) => l.action === "webhook.delivery_retried"), "the manual retry is audited");
  });

  await runTest("a delivery is claimed once: while one server sends it, it is not due for anyone else", async () => {
    const e = event("order.created");
    webhookPlatformService.enqueueFromEvents();
    const id = webhookPlatformService.listDeliveries(orgId, sub.id).find((x) => x.source_event_id === e.id)?.id;
    assert.ok(id);
    const claim = (webhookPlatformService as unknown as { claim: (id: string, now: Date) => Promise<unknown> }).claim.bind(webhookPlatformService);
    assert.ok(await claim(id, new Date()), "first claim wins");
    assert.strictEqual(await claim(id, new Date()), null, "second claim loses");
    assert.ok(!db.getDueWebhookDeliveries(nowIso(), 100).some((x) => x.id === id));
    assert.ok(db.getDueWebhookDeliveries(later(120_000).toISOString(), 100).some((x) => x.id === id), "an abandoned claim expires");
    await webhookPlatformService.runOnce({ now: later(120_000) });
    assert.strictEqual(db.findWebhookDelivery(id)?.status, "DELIVERED");
  });

  await runTest("a burst larger than one pass (1,100 events at the same instant) is worked through, never stalls", async () => {
    const at = nowIso();
    for (let i = 0; i < 1_100; i++) {
      db.recordEvent({ id: `evt_burst_${i.toString().padStart(4, "0")}`, type: "order.created", version: "1", tenant_id: tenantId, aggregate_type: "order", aggregate_id: `ord_b${i}`, timestamp: at, payload: {} });
    }
    const first = webhookPlatformService.enqueueFromEvents();
    const second = webhookPlatformService.enqueueFromEvents();
    assert.strictEqual(first, 1_000, "one pass queues at most 1,000 per subscription");
    assert.strictEqual(second, 100, "the rest follows on the next pass");
    await new Promise((r) => setTimeout(r, 5));
    const tail = event("order.created");
    assert.strictEqual(webhookPlatformService.enqueueFromEvents(), 1, "a later event still gets through");
    assert.ok(db.getWebhookDeliveries(sub.id).some((d) => d.source_event_id === tail.id));
    // Clear the backlog so later tests aren't slowed by it
    for (const d of db.getWebhookDeliveries(sub.id)) if (d.status === "PENDING") db.updateWebhookDelivery(d.id, { status: "DELIVERED" });
  });

  await runTest("fair share: one organization's backlog doesn't delay another organization's first delivery", async () => {
    const otherSub = await webhookPlatformService.subscribe(otherOrg, { targetUrl: hookUrl, eventTypes: ["order.created"] });
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 30; i++) event("order.created");
    event("order.created", {}, other.tenantId);
    const run = await webhookPlatformService.runOnce({ limit: 20 });
    assert.ok(run.attempted <= 20);
    const otherDelivery = db.getWebhookDeliveries(otherSub.id)[0];
    assert.strictEqual(otherDelivery?.status, "DELIVERED", "the other organization was served in the same pass");
    for (const d of db.getWebhookDeliveries(sub.id)) if (d.status === "PENDING") db.updateWebhookDelivery(d.id, { status: "DELIVERED" });
  });

  await runTest("a suspended or kill-switched workspace sends nothing", async () => {
    const tenant = db.findTenantById(tenantId);
    assert.ok(tenant);
    const before = hooks.received.length;
    db.updateTenant(tenantId, { status: "SUSPENDED" });
    event("order.created");
    let run = await webhookPlatformService.runOnce();
    assert.strictEqual(run.queued + run.attempted, 0);
    db.updateTenant(tenantId, { status: tenant.status });
    const kill = { id: uid("ks"), scope: "TENANT" as const, target_id: tenantId, is_active: true, reason: "p5 test", activated_by_user_id: "usr_p5", updated_at: nowIso() };
    db.savePlatformKillSwitch(kill);
    assert.strictEqual(PlatformSafetyService.isExecutionBlocked("TENANT", tenantId), true);
    run = await webhookPlatformService.runOnce();
    assert.strictEqual(run.attempted, 0, "kill switch: nothing sent");
    db.savePlatformKillSwitch({ ...kill, is_active: false });
    await webhookPlatformService.runOnce();
    assert.ok(hooks.received.length > before, "sent once the workspace is active again");
  });

  await runTest("20 failures in a row pause the subscription; resume restarts it", async () => {
    db.updateEnterpriseWebhook(orgId, sub.id, { failed_consecutive_deliveries: 19 });
    hookStatus = 503;
    event("order.created");
    await webhookPlatformService.runOnce();
    const paused = db.findEnterpriseWebhook(orgId, sub.id);
    assert.strictEqual(paused?.status, "PAUSED");
    assert.ok(paused?.paused_reason?.includes("20"));
    const before = hooks.received.length;
    event("order.created");
    await webhookPlatformService.runOnce({ now: later(24 * 3_600_000) });
    assert.strictEqual(hooks.received.length, before, "a paused subscription sends nothing");
    hookStatus = 200;
    assert.strictEqual(webhookPlatformService.resumeSubscription(orgId, sub.id).status, "ACTIVE");
  });

  await runTest("another organization can't read, retry or resume this organization's webhooks (IDOR)", () => {
    assert.throws(() => webhookPlatformService.listDeliveries(otherOrg, sub.id), /not found/i);
    const any = db.getWebhookDeliveries(sub.id)[0];
    assert.throws(() => webhookPlatformService.retryDelivery(otherOrg, any.id), /not found/i);
    assert.throws(() => webhookPlatformService.resumeSubscription(otherOrg, sub.id), /not found/i);
  });

  await runTest("routes: private target → 422, unknown fields → 400, deliveries of another org's subscription → 404; both POSTs run outside the store lock", async () => {
    const { token } = await AuthService.login(shop.user.email, "Phase5-Owner-Pass-7713!");
    const post = (await import("@/app/api/v1/enterprise/webhooks/route")).POST;
    const req = (body: unknown) =>
      post(new Request("http://localhost/api/v1/enterprise/webhooks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    assert.strictEqual((await req({ url: "https://192.168.1.10/hook" })).status, 422);
    assert.strictEqual((await req({ url: hookUrl, secret: "mine" })).status, 400);
    const created = await req({ url: hookUrl, events: ["order.created"] });
    assert.strictEqual(created.status, 201);
    assert.ok(db.getAuditLogsByTenant(tenantId, 200).logs.some((l) => l.action === "webhook.subscribed"), "subscribing is audited");
    const getDeliveries = (await import("@/app/api/v1/enterprise/webhooks/[id]/deliveries/route")).GET;
    const foreignSub = await webhookPlatformService.subscribe(otherOrg, { targetUrl: hookUrl, eventTypes: ["*"] });
    const res = await getDeliveries(new Request(`http://localhost/api/v1/enterprise/webhooks/${foreignSub.id}/deliveries`, { headers: { authorization: `Bearer ${token}` } }), {
      params: Promise.resolve({ id: foreignSub.id }),
    });
    assert.strictEqual(res.status, 404);
    for (const route of ["src/app/api/v1/enterprise/webhooks/route.ts", "src/app/api/v1/connectors/test/route.ts"]) {
      assert.ok(/withStore\("POST", handlePOST, \{ unit: false \}\)/.test(fs.readFileSync(path.join(ROOT, route), "utf8")), `${route}: outbound work outside the lock`);
    }
  });

  setOutboundTransportForTesting(null);
  setOutboundLookupForTesting(null);
  process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = `127.0.0.1:${local.port},127.0.0.1:${hooks.port}`;

  // ---------------------------------------------------------------------------
  out(`\n${ANSI_BOLD}[FX-55] n8n called for real, signed, with the SSRF guard on stored URLs${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const invoke = () =>
    N8nProviderService.invokeWorkflow({
      tenantId, automationId: uid("auto"), workflowId: uid("wf"), workflowVersionId: "v1", webhookPath: "p5-flow",
      event: { type: "p5" }, correlationId: uid("corr"), idempotencyKey: uid("idem"), executionMode: "PRODUCTION",
    });

  await runTest("the deployment's n8n (N8N_HOST) is called, and the call is signed", async () => {
    const saved = { host: process.env.N8N_HOST, secret: process.env.COMMERCEOS_N8N_WEBHOOK_SECRET, allow: process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS };
    process.env.N8N_HOST = `http://127.0.0.1:${hooks.port}`;
    process.env.COMMERCEOS_N8N_WEBHOOK_SECRET = "n8n-shared-secret-for-tests-0123456789";
    delete process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS; // platform configuration needs no allow-list
    try {
      const before = hooks.received.length;
      const result = await invoke();
      assert.strictEqual(result.success, true, `${result.execution.error_code}: ${result.execution.error_message_reference}`);
      const got = hooks.received[before];
      assert.strictEqual(got.path, "/webhook/p5-flow");
      assert.ok(verifyOutboundSignature(process.env.COMMERCEOS_N8N_WEBHOOK_SECRET, got.body, String(got.headers["x-commerceos-timestamp"]), String(got.headers["x-commerceos-signature"])));
    } finally {
      for (const [k, v] of [["N8N_HOST", saved.host], ["COMMERCEOS_N8N_WEBHOOK_SECRET", saved.secret], ["OUTBOUND_ALLOWED_PRIVATE_HOSTS", saved.allow]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  await runTest("a stored n8n instance pointing at a private address is refused (M17) and nothing is sent", async () => {
    const savedAllow = process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS;
    delete process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS;
    db.createN8nInstance({
      id: uid("n8n"), tenant_id: tenantId, name: "Stored", base_url: `http://127.0.0.1:${hooks.port}`, environment: "PRODUCTION", status: "ACTIVE",
      health_status: "UNKNOWN", credential_reference: "COMMERCEOS_N8N_API_KEY", workflow_namespace: "commerceos", created_at: nowIso(), updated_at: nowIso(),
    });
    try {
      const before = hooks.received.length;
      const result = await invoke();
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.execution.error_message_reference, "the n8n address is not allowed");
      assert.strictEqual(hooks.received.length, before);
    } finally {
      if (savedAllow === undefined) delete process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS;
      else process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = savedAllow;
    }
  });

  await hooks.close();
  await local.close();
  if (savedAllow === undefined) delete process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS;
  else process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS = savedAllow;

  out(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  out(`  Tests Passed: ${passed} | Tests Failed: ${failed}`);
  out(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
