/**
 * AI fix plan Stage 4 (launch): staging and edge hardening (FX-86) and the shadow → Telegram pilot rollout (FX-87):
 * CSP reports and the enforce switch, the staging service, dependency hygiene, verified Telegram contacts, pilot hours,
 * shadow-draft ratings, rollout go/no-go numbers and the provider kill switch.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { OrderService } from "@/domains/orders/order.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { TelegramAdapter } from "@/domains/social/channels/adapters/telegram.adapter";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { modelRouter } from "@/domains/ai/providers/model-router";
import type { LLMProvider, LLMResponse } from "@/domains/ai/providers/llm-provider.interface";
import { principalFor, visibleOrders } from "@/domains/ai/customer-agent/principal";
import { AUTONOMOUS_FLAG, SHADOW_FLAG } from "@/domains/ai/customer-agent/jobs";
import { runAgentJobsOnce } from "@/domains/ai/customer-agent/worker";
import { ShadowRatingService } from "@/domains/ai/customer-agent/shadow-rating.service";
import { computeRollout } from "@/domains/platform/services/agent-rollout.service";
import { CspReportService, blockedOrigin, parseCspReports } from "@/domains/platform/services/csp-report.service";
import { IdentityResolutionService } from "@/domains/social/identity/identity-resolution.service";
import { localHour, hourWithin } from "@/lib/local-time";
import { signSessionToken } from "@/lib/security";
import { PERMISSIONS } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";
import type { ConnectedChannel, Message, NormalizedIncomingMessage } from "@/types/social";

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
type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- free-form JSON
const BASE = "http://localhost:3000/api/v1";
const ROOT = process.cwd();

class Scripted implements LLMProvider {
  public readonly providerName = "scripted";
  public calls = 0;
  public reply = "Ji, bolun.";
  async chat(): Promise<LLMResponse> {
    this.calls++;
    return { content: this.reply, tool_calls: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, model: "scripted", latency_ms: 1 };
  }
  async generate(): Promise<string> {
    return "";
  }
  async structuredOutput<T>(): Promise<{ data: T; usage: LLMResponse["usage"]; latency_ms: number }> {
    throw new Error("unused");
  }
  async embed(): Promise<number[]> {
    return [1, 0, 0];
  }
}

async function main() {
  console.log(`\n${BOLD}STAGE 4: LAUNCH${RESET}\n`);

  // ================================================================ FX-86
  console.log(`${BOLD}FX-86 staging and edge hardening${RESET}`);
  await runTest("CSP reports keep only day, directive and origin; both report formats are read", () => {
    assert.strictEqual(blockedOrigin("https://evil.example/x.js?token=secret"), "https://evil.example");
    assert.strictEqual(blockedOrigin("inline"), "inline");
    const classic = parseCspReports({ "csp-report": { "effective-directive": "script-src-elem", "blocked-uri": "https://cdn.example/a.js", "document-uri": "https://shop/x?phone=01711000001" } });
    assert.deepStrictEqual(classic, [{ directive: "script-src-elem", blocked: "https://cdn.example" }]);
    const api = parseCspReports([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data" } }, { type: "deprecation", body: {} }]);
    assert.deepStrictEqual(api, [{ directive: "img-src", blocked: "data" }]);
  });

  await runTest("the report endpoint counts violations; oversized or broken bodies are refused; summary says when to enforce", async () => {
    db.clearAllForTesting();
    assert.strictEqual(CspReportService.summary().ready_to_enforce, true);
    const mod = await import("@/app/api/v1/csp-report/route");
    const post = (body: string) => mod.POST(new Request(`${BASE}/csp-report`, { method: "POST", headers: { "content-type": "application/csp-report" }, body }));
    const report = JSON.stringify({ "csp-report": { "effective-directive": "script-src", "blocked-uri": "https://x.example/a.js" } });
    assert.strictEqual((await post(report)).status, 204);
    assert.strictEqual((await post(report)).status, 204);
    assert.strictEqual((await post("not json")).status, 400);
    assert.strictEqual((await post("x".repeat(20_000))).status, 413);
    const s = CspReportService.summary();
    assert.strictEqual(s.last_7_days, 2);
    assert.strictEqual(s.ready_to_enforce, false);
    assert.ok(!JSON.stringify(db.data.csp_reports).includes("/a.js"), "no paths stored");
    // A declared oversize body is refused before it is read; a body with no violation spends no rate budget
    const big = await mod.POST(new Request(`${BASE}/csp-report`, { method: "POST", headers: { "content-length": "999999" }, body: "{}" }));
    assert.strictEqual(big.status, 413);
    assert.strictEqual((await post("{}")).status, 204);
    assert.strictEqual(CspReportService.summary().last_7_days, 2, "junk counts nothing");
  });

  await runTest("reports that couldn't be counted (rate-limited, over the cap) keep the week from looking clean", () => {
    db.clearAllForTesting();
    assert.strictEqual(CspReportService.summary().ready_to_enforce, true);
    CspReportService.recordDropped(3);
    const s = CspReportService.summary();
    assert.strictEqual(s.last_7_days, 0);
    assert.strictEqual(s.dropped_last_7_days, 3);
    assert.strictEqual(s.ready_to_enforce, false);
  });

  await runTest("through the route: a rate-limited report answers 429 and is still counted as dropped", async () => {
    db.clearAllForTesting();
    const mod = await import("@/app/api/v1/csp-report/route");
    const report = JSON.stringify({ "csp-report": { "effective-directive": "script-src", "blocked-uri": "https://y.example/b.js" } });
    let limited = 0;
    for (let i = 0; i < 620 && !limited; i++) {
      const res = await mod.POST(new Request(`${BASE}/csp-report`, { method: "POST", body: report }));
      if (res.status === 429) limited++;
    }
    assert.strictEqual(limited, 1, "the overall limit trips");
    const s = CspReportService.summary();
    assert.ok(s.dropped_last_7_days >= 1);
    assert.strictEqual(s.ready_to_enforce, false);
  });

  await runTest("CSP_ENFORCE switches the header from Report-Only to enforcing; reports go to the endpoint", async () => {
    const load = (enforce: string | undefined) => {
      const file = path.join(ROOT, "next.config.js");
      delete require.cache[require.resolve(file)];
      if (enforce === undefined) delete process.env.CSP_ENFORCE;
      else process.env.CSP_ENFORCE = enforce;
      return require(file) as { headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> };
    };
    const off = (await load(undefined).headers())[0].headers;
    assert.ok(off.some((h) => h.key === "Content-Security-Policy-Report-Only" && h.value.includes("report-uri /api/v1/csp-report")));
    assert.ok(!off.some((h) => h.key === "Content-Security-Policy"));
    const on = (await load("1").headers())[0].headers;
    assert.ok(on.some((h) => h.key === "Content-Security-Policy" && h.value.includes("object-src 'none'")));
    delete process.env.CSP_ENFORCE;
  });

  await runTest("staging is a separate service with every production setting and its own secrets", () => {
    const yaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");
    const blocks = yaml.split(/\n  - type: web\n/).slice(1);
    const named = (n: string) => blocks.find((b) => new RegExp(`^    name: ${n}\\n`).test(b))!;
    const prod = named("commerceos");
    const staging = named("commerceos-staging");
    assert.ok(prod && staging);
    const keys = (b: string) => [...b.matchAll(/- key: (\w+)/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(keys(staging), keys(prod));
    for (const secret of ["DATABASE_URL", "JWT_SECRET", "CREDENTIALS_ENCRYPTION_KEY", "LLM_API_KEY", "JOBS_TOKEN_SHA256"]) {
      assert.match(staging, new RegExp(`- key: ${secret}\\n\\s+sync: false`), `${secret} is entered separately for staging`);
    }
    assert.match(staging, /- key: CSP_ENFORCE\n\s+value: "1"/, "staging enforces the CSP first");
  });

  await runTest("deploys gate production on the agent eval smoke when AGENT_EVAL_GATE is on", () => {
    const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    assert.match(wf, /agent-eval-gate:/);
    assert.match(wf, /needs: \[staging, agent-eval-gate\]/);
    assert.match(wf, /vars\.AGENT_EVAL_GATE == 'on'/);
    // Only pushes to main in this repository deploy or see a secret (a fork PR from a branch named main must not)
    assert.strictEqual((wf.match(/workflow_run\.event == 'push' && github\.event\.workflow_run\.head_repository\.full_name == github\.repository/g) || []).length, 3);
    // The eval key never sits in npm ci's environment
    for (const file of ["deploy.yml", "agent-evals.yml"]) {
      const text = fs.readFileSync(path.join(ROOT, ".github/workflows", file), "utf8");
      const jobEnv = text.split("steps:")[0];
      assert.ok(!jobEnv.includes("OLLAMA_EVAL_API_KEY") || file === "agent-evals.yml" && !/^    env:[\s\S]*OLLAMA_EVAL_API_KEY[\s\S]*^    steps:/m.test(text), `${file}: the key is set only on the eval steps`);
    }
  });

  await runTest("the Linux esbuild binary is optional, in package.json and the lockfile", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
    assert.ok(!pkg.dependencies["@esbuild/linux-x64"] && pkg.optionalDependencies["@esbuild/linux-x64"]);
    assert.ok(!lock.packages[""].dependencies["@esbuild/linux-x64"] && lock.packages[""].optionalDependencies["@esbuild/linux-x64"]);
    assert.strictEqual(lock.packages["node_modules/@esbuild/linux-x64"].optional, true);
  });

  // ================================================================ FX-87 fixture
  db.clearAllForTesting();
  const stamp = Date.now();
  const reg = await AuthService.registerTenantWithOwner({ workspaceName: "Pilot Shop", name: "Pilot Owner", email: `s4-${stamp}@example.com`, password: "Stage4-Test-Pass-2026!", currency: "BDT" });
  db.ensureDefaultSeed(reg.tenant.id);
  const tenantId = reg.tenant.id;
  const owner: RequestContext = {
    requestId: "req_s4", traceId: "tr_s4", user: { id: reg.user.id, email: reg.user.email, name: reg.user.name, status: "ACTIVE" },
    tenant: { id: tenantId, name: reg.tenant.name, slug: reg.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER", permissions: Object.values(PERMISSIONS), timestamp: new Date().toISOString(),
  };
  const product = await ProductService.createProduct(owner, { name: "Black T-Shirt", sku: "TS", base_price: 650, status: "ACTIVE", variants: [{ title: "L", sku: "TS-L", price: 650, initial_stock: 50, attributes: { size: "L" } }] } as never);
  const variantId = db.getProductVariants(tenantId, product.id)[0].id;
  const telegramSends: R[] = [];
  setOutboundTransportForTesting(async (url, options) => {
    if (url.pathname.endsWith("/sendMessage")) telegramSends.push(JSON.parse(String(options.body)));
    return { status: 200, headers: {}, body: JSON.stringify({ ok: true, result: { message_id: telegramSends.length, id: 1, is_bot: true } }), truncated: false, durationMs: 1 };
  });
  const channel = (await ChannelService.connectChannel(owner, { type: "TELEGRAM", name: "TG", provider_account_id: `tg_${stamp}`, credentials: { bot_token: `${"8".repeat(9)}:${"B".repeat(35)}` } } as never)) as ConnectedChannel;
  const tg = db.findConnectedChannelById(tenantId, channel.id)!;
  const scripted = new Scripted();
  modelRouter.setPrimaryProvider(scripted);
  modelRouter.setFallbackProvider(null);
  db.setAIPolicy({ ...db.getAIPolicy(tenantId), ai_mode: "AI_AUTONOMOUS", is_enabled: true, allowed_channel_types: [...db.getAIPolicy(tenantId).allowed_channel_types, "TELEGRAM"] });
  const flag = (key: string, on: boolean) =>
    db.savePlatformFeatureFlag({ id: `ff_${key}`, key, description: key, is_enabled_globally: false, percentage_rollout: 100, scope: "TENANT", tenant_allowlist: on ? [tenantId] : [], rules: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never);
  let upd = 1000;
  const update = (chat: number, from: number, extra: R) => ({ update_id: ++upd, message: { message_id: upd, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: "private" }, from: { id: from, first_name: "Rahim" }, ...extra } });
  const ingest = async (raw: R) => {
    const msgs = new TelegramAdapter().normalizeIncomingEvent(raw, tg.id) as NormalizedIncomingMessage[];
    await WebhookIngressService.ingestNormalized(tg, msgs, []);
    return msgs;
  };
  const conv = (chat: number) => db.findConversationByExternalId(tenantId, tg.id, String(chat))!;
  const makeDue = (cid: string) => {
    const j = db.findAgentJob(tenantId, cid)!;
    db.saveAgentJob({ ...j, not_before: new Date(Date.now() - 1).toISOString() });
  };

  // ================================================================ FX-87
  console.log(`\n${BOLD}FX-87 shadow → Telegram pilot${RESET}`);
  await runTest("Telegram: only the sender's own contact proves a phone number", () => {
    const own = new TelegramAdapter().normalizeIncomingEvent(update(501, 501, { contact: { phone_number: "8801711000001", user_id: 501 } }), "ch")[0];
    assert.strictEqual(own.verifiedPhone, "8801711000001");
    assert.ok(!own.text.includes("01711000001"), "the number isn't put into the chat text");
    const other = new TelegramAdapter().normalizeIncomingEvent(update(502, 502, { contact: { phone_number: "8801822000002", user_id: 999 } }), "ch")[0];
    assert.strictEqual(other.verifiedPhone, undefined);
    assert.strictEqual(other.text, "[Shared a contact]");
    const typed = new TelegramAdapter().normalizeIncomingEvent(update(503, 503, { text: "amar number 01711000001" }), "ch")[0];
    assert.strictEqual(typed.verifiedPhone, undefined, "a typed number proves nothing");
  });

  await runTest("sharing their own contact links the chat to their earlier orders (verified phone); before that only chat orders show", async () => {
    flag(AUTONOMOUS_FLAG, false);
    flag(SHADOW_FLAG, false);
    const earlier = await OrderService.createOrder(owner, { customer: { first_name: "Rahim", last_name: "Uddin", phone: "01711000001" }, delivery_address: { district: "Dhaka", address_line_1: "Road 1" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    await ingest(update(601, 601, { text: "amar order kothay? 01711000001" }));
    let pr = principalFor(tenantId, conv(601).id)!;
    assert.strictEqual(pr.assurance, "CHANNEL");
    assert.strictEqual(visibleOrders(pr).length, 0, "a typed number links nothing");
    await ingest(update(601, 601, { contact: { phone_number: "8801711000001", user_id: 601 } }));
    pr = principalFor(tenantId, conv(601).id)!;
    assert.strictEqual(pr.assurance, "VERIFIED_PHONE");
    assert.strictEqual(pr.customerId, earlier.customer_id);
    assert.deepStrictEqual(visibleOrders(pr).map((o) => o.id), [earlier.id]);
    assert.ok(db.data.audit_logs.some((l) => l.action === "CHANNEL_PHONE_VERIFIED"));
    // Someone else's contact card changes nothing
    await ingest(update(602, 602, { text: "hi" }));
    await ingest(update(602, 602, { contact: { phone_number: "8801711000001", user_id: 601 } }));
    const other = principalFor(tenantId, conv(602).id)!;
    assert.strictEqual(other.assurance, "CHANNEL");
    assert.strictEqual(visibleOrders(other).length, 0);
  });

  await runTest("a verified contact never upgrades a claim-linked or mismatched customer; duplicates aren't linked", async () => {
    // Customer K, whose orders a stranger must not see
    const k = await OrderService.createOrder(owner, { customer: { first_name: "Victim", last_name: "K", phone: "01999000009" }, delivery_address: { district: "Dhaka", address_line_1: "Road 9" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    // A Telegram identity linked to K by a claimed phone (PHONE_MATCH), then a contact share of an unknown number
    const res = await IdentityResolutionService.resolveCustomer(tenantId, tg.id, "TELEGRAM", "tg_claim_901", { displayName: "Attacker", phone: "01999000009" });
    assert.strictEqual(res.customer.id, k.customer_id);
    assert.strictEqual(res.identity.metadata.resolution_strategy, "PHONE_MATCH");
    const moved = await IdentityResolutionService.linkVerifiedPhone(tenantId, res.identity, "8801344000044");
    assert.notStrictEqual(moved.id, k.customer_id, "the identity leaves K");
    assert.strictEqual(moved.phone, "+8801344000044");
    const identity = db.getCustomerIdentities(tenantId, moved.id).find((i) => i.id === res.identity.id)!;
    assert.strictEqual(identity.metadata.resolution_strategy, "TELEGRAM_VERIFIED_CONTACT");
    assert.ok(!db.getCustomerIdentities(tenantId, k.customer_id).some((i) => i.id === res.identity.id));
    // Two customers with the same number: nothing is linked or verified
    for (const n of ["One", "Two"]) db.createCustomer({ id: `cust_dup_${n}_${stamp}`, tenant_id: tenantId, first_name: n, last_name: "Dup", phone: "+8801355000055", status: "ACTIVE", source: "MANUAL", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never);
    const res2 = await IdentityResolutionService.resolveCustomer(tenantId, tg.id, "TELEGRAM", "tg_dup_902", { displayName: "Dup Tester" });
    const after = await IdentityResolutionService.linkVerifiedPhone(tenantId, res2.identity, "8801355000055");
    assert.strictEqual(after.id, res2.customer.id);
    assert.notStrictEqual(db.getCustomerIdentities(tenantId, res2.customer.id).find((i) => i.id === res2.identity.id)?.metadata.resolution_strategy, "TELEGRAM_VERIFIED_CONTACT");
    assert.ok(db.data.audit_logs.some((l) => l.action === "CHANNEL_PHONE_VERIFIED" && (l.metadata as R).outcome === "AMBIGUOUS_NOT_LINKED"));
  });

  const nowHour = localHour({ timezone: "Asia/Dhaka" }, Date.now());
  await runTest("pilot hours: outside them, no model call; the chat goes to the team and the customer is told when", async () => {
    assert.ok(hourWithin(23, 22, 6) && hourWithin(3, 22, 6) && !hourWithin(12, 22, 6) && hourWithin(10, 10, 22) && !hourWithin(22, 10, 22));
    flag(AUTONOMOUS_FLAG, true);
    const t = db.findTenantById(tenantId)!;
    db.updateTenant(tenantId, { settings: { ...(t.settings as R), customer_agent_hours: { start_hour: (nowHour + 1) % 24, end_hour: (nowHour + 2) % 24 } } } as never);
    await ingest(update(701, 701, { text: "hello" }));
    const c = conv(701);
    makeDue(c.id);
    const calls = scripted.calls;
    const sends = telegramSends.length;
    await runAgentJobsOnce();
    assert.strictEqual(scripted.calls, calls, "no model call outside hours");
    assert.strictEqual(db.findAgentJob(tenantId, c.id)!.outcome, "OUTSIDE_HOURS");
    assert.strictEqual(telegramSends.length, sends + 1);
    assert.match(String(telegramSends[telegramSends.length - 1].text), /team/i);
    const after = conv(701);
    assert.strictEqual(after.automation_paused, true);
    assert.strictEqual((after.metadata.handoff_card as R).reason, "other");
  });

  await runTest("pilot hours: inside them the agent answers", async () => {
    const t = db.findTenantById(tenantId)!;
    db.updateTenant(tenantId, { settings: { ...(t.settings as R), customer_agent_hours: { start_hour: nowHour, end_hour: (nowHour + 1) % 24 } } } as never);
    await ingest(update(702, 702, { text: "hello" }));
    const c = conv(702);
    makeDue(c.id);
    const calls = scripted.calls;
    await runAgentJobsOnce();
    assert.strictEqual(scripted.calls, calls + 1);
    assert.strictEqual(conv(702).automation_paused, false);
  });

  await runTest("PROVIDER kill switch: no model call; the customer gets the standard reply and a person takes over", async () => {
    db.savePlatformKillSwitch({ id: `ks_prov_${stamp}`, scope: "PROVIDER", target_id: "scripted", is_active: true, reason: "rehearsal", activated_by_user_id: "op", updated_at: new Date().toISOString() } as never);
    await ingest(update(703, 703, { text: "hello" }));
    const c = conv(703);
    makeDue(c.id);
    const calls = scripted.calls;
    await runAgentJobsOnce();
    db.savePlatformKillSwitch({ ...db.findPlatformKillSwitch(`ks_prov_${stamp}`)!, is_active: false });
    assert.strictEqual(scripted.calls, calls);
    assert.strictEqual(conv(703).automation_paused, true);
  });

  await runTest("shadow drafts are rated by staff; the rating lands on the run", async () => {
    flag(AUTONOMOUS_FLAG, false);
    flag(SHADOW_FLAG, true);
    await ingest(update(801, 801, { text: "dam koto?" }));
    const c = conv(801);
    makeDue(c.id);
    await runAgentJobsOnce();
    const draft = conv(801).metadata.agent_shadow_reply as R;
    assert.ok(draft?.run_id);
    const mod = await import("@/app/api/v1/social/conversations/[id]/agent-draft/route");
    const token = await signSessionToken({ userId: reg.user.id, tenantId, role: "OWNER", email: reg.user.email, name: reg.user.name, sv: db.findUserById(reg.user.id)?.session_version ?? 1 });
    const post = (id: string, body: unknown) => mod.POST(new Request(`${BASE}/social/conversations/${id}/agent-draft`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    assert.strictEqual((await post(c.id, { rating: "MAYBE" })).status, 400);
    const ok = await post(c.id, { rating: "USABLE" });
    assert.strictEqual(ok.status, 200, await ok.clone().text());
    assert.strictEqual((db.findAgentRunById(tenantId, draft.run_id)!.metadata as R).shadow_rating, "USABLE");
    assert.strictEqual((conv(801).metadata.agent_shadow_reply as R).rating.value, "USABLE");
    assert.strictEqual((await post(c.id, { rating: "NOT_USABLE" })).status, 409, "a draft is rated once");
    assert.ok(db.data.audit_logs.some((l) => l.action === "AGENT_DRAFT_RATED" && l.resource_id === draft.run_id));
    assert.strictEqual((await post(conv(701).id, { rating: "USABLE" })).status, 400, "no draft to rate");
  });

  await runTest("rollout numbers: usable share, money guards, handoff queue age and the go checks", () => {
    const now = Date.now();
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    const run = (i: number, m: R, latency = 3000) => ({ id: `r${i}`, tenant_id: tenantId, agent_type: "CUSTOMER_AGENT", started_at: at(30), completed_at: at(29), latency_ms: latency, metadata: m }) as never;
    const runs = [
      ...Array.from({ length: 18 }, (_, i) => run(i, { shadow: true, shadow_rating: "USABLE" })),
      ...Array.from({ length: 2 }, (_, i) => run(100 + i, { shadow: true, shadow_rating: "NOT_USABLE" })),
      run(200, { shadow: true }),
    ];
    const report = computeRollout(runs, now, 7, tenantId);
    assert.deepStrictEqual(report.shadow, { drafts: 21, rated: 20, usable: 18, usable_share: 90 });
    assert.strictEqual(report.go.shadow_to_pilot.ready, true, JSON.stringify(report.go));
    const blocked = computeRollout([...runs, run(300, { guards: ["order_claim_blocked"] })], now, 7, tenantId);
    assert.strictEqual(blocked.money_guard_triggers, 1);
    assert.strictEqual(blocked.go.shadow_to_pilot.ready, false);
    // The handoff from the outside-hours test is still unanswered: it counts with its age
    assert.ok(report.handoffs.count >= 1 && report.handoffs.answered === 0);
    assert.ok(report.manual_checks.length >= 3);
  });

  await runTest("the rollout and health views are platform-only", async () => {
    const token = await signSessionToken({ userId: reg.user.id, tenantId, role: "OWNER", email: reg.user.email, name: reg.user.name, sv: db.findUserById(reg.user.id)?.session_version ?? 1 });
    const mod = await import("@/app/api/v1/platform/ai/agent-rollout/route");
    const res = await mod.GET(new Request(`${BASE}/platform/ai/agent-rollout`, { headers: { authorization: `Bearer ${token}` } }));
    assert.ok(res.status === 401 || res.status === 403, String(res.status));
  });

  setOutboundTransportForTesting(null);
  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
