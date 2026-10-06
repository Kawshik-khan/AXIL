/**
 * AI fix plan Stage 3 (quality and compliance): tracing and alerts (FX-81), RAG fixes (FX-82), retention and erasure
 * (FX-83), atomic handoff and context card (FX-84), no unwritten memory (FX-85), the domain-event outbox and job
 * endpoints (FX-99 Part B). The eval gate (FX-80) has its own suite, tests/agent-evals-offline-tests.ts.
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { OrderService } from "@/domains/orders/order.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { MessageService } from "@/domains/social/messages/message.service";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { banglaSubQuery } from "@/domains/ai/rag/agentic-rag.controller";
import { embeddingMetrics, resetEmbeddingMetrics, EmbeddingService } from "@/domains/ai/rag/embedding.service";
import { modelRouter } from "@/domains/ai/providers/model-router";
import type { LLMMessage, LLMProvider, LLMResponse } from "@/domains/ai/providers/llm-provider.interface";
import { principalFor } from "@/domains/ai/customer-agent/principal";
import { runCustomerTurn } from "@/domains/ai/customer-agent/runtime";
import { runCustomerTool } from "@/domains/ai/customer-agent/tools";
import { RequestHumanHandoffTool } from "@/domains/ai/tools/implementations/human-tools";
import { AgentHealthService, computeAgentHealth } from "@/domains/platform/services/agent-health.service";
import { maskPhone, redactToolPayload } from "@/lib/pii-mask";
import { PIIRedactionService } from "@/domains/ai/context/pii-redaction.service";
import { RetentionService } from "@/domains/privacy/retention.service";
import { CustomerErasureService } from "@/domains/privacy/customer-erasure.service";
import { RbacService } from "@/domains/rbac/service";
import { AutomationRouterService } from "@/domains/automation/services/automation-router.service";
import { dispatchOutboxOnce, MAX_DISPATCH_ATTEMPTS } from "@/domains/automation/outbox/dispatcher";
import { JobsService, bucketOf, localHour } from "@/domains/jobs/jobs.service";
import { signSessionToken, signStepUpToken, WORKSPACE_STEP_UP_PREFIX } from "@/lib/security";
import { PERMISSIONS } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";
import type { Message } from "@/types/social";

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
type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- free-form JSON results
const BASE = "http://localhost:3000/api/v1";
const DAY = 24 * 60 * 60_000;

const ctxFor = (tenant: { id: string; name: string; slug: string }, user: { id: string; email: string; name: string }, role = "OWNER"): RequestContext => ({
  requestId: "req_s3",
  traceId: "tr_s3",
  user: { id: user.id, email: user.email, name: user.name, status: "ACTIVE" },
  tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
  role: role as RequestContext["role"],
  permissions: role === "OWNER" ? Object.values(PERMISSIONS) : RbacService.getPermissionsForRole(role as never),
  timestamp: new Date().toISOString(),
});

/** A scripted model: each call returns the next step. */
class Scripted implements LLMProvider {
  public readonly providerName = "scripted";
  public steps: Array<(m: LLMMessage[]) => Partial<LLMResponse>> = [];
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const step = this.steps.shift();
    if (!step) throw new Error("no step");
    return { content: "", tool_calls: [], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cached_tokens: 40 }, model: "scripted-model", latency_ms: 3, queue_ms: 2, throttled: 1, ...step(messages) };
  }
  async generate(): Promise<string> {
    return "";
  }
  async structuredOutput<T>(): Promise<{ data: T; usage: LLMResponse["usage"]; latency_ms: number }> {
    throw new Error("unused");
  }
  async embed(text: string): Promise<number[]> {
    const v = new Array(64).fill(0);
    for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) v[[...w].reduce((h, c) => (h * 31 + c.codePointAt(0)!) >>> 0, 7) % 64] += 1;
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  }
}

async function main() {
  console.log(`\n${BOLD}STAGE 3: QUALITY AND COMPLIANCE${RESET}\n`);
  db.clearAllForTesting();
  const stamp = Date.now();
  const reg = await AuthService.registerTenantWithOwner({ workspaceName: "Dhaka Fashion House", name: "Owner", email: `s3-${stamp}@example.com`, password: "Stage3-Test-Pass-2026!", currency: "BDT" });
  db.ensureDefaultSeed(reg.tenant.id);
  const tenantId = reg.tenant.id;
  const owner = ctxFor(reg.tenant, reg.user);
  const scripted = new Scripted();
  modelRouter.setPrimaryProvider(scripted);
  modelRouter.setFallbackProvider(null);
  (modelRouter as unknown as { embeddingProvider: LLMProvider }).embeddingProvider = scripted;

  const product = await ProductService.createProduct(owner, {
    name: "Black Cotton T-Shirt", sku: "TS-BLK", base_price: 650, status: "ACTIVE",
    variants: [{ title: "L", sku: "TS-BLK-L", price: 650, initial_stock: 12, attributes: { size: "L" } }],
  } as never);
  const variantId = db.getProductVariants(tenantId, product.id)[0].id;
  const channelId = (await ChannelService.connectChannel(owner, { type: "FACEBOOK_MESSENGER", name: "Page", provider_account_id: `pg_${stamp}`, credentials: { pageId: `pg_${stamp}`, accessToken: "placeholder" } } as never)).id;
  let seq = 0;
  const say = (conversationId: string, from: "customer" | "agent", text: string) => {
    seq++;
    const t = new Date(Date.now() + seq).toISOString();
    db.createMessage({ id: `msg_s3_${stamp}_${seq}`, tenant_id: tenantId, conversation_id: conversationId, direction: from === "customer" ? "INBOUND" : "OUTBOUND", sender_type: from === "customer" ? "CUSTOMER" : "AGENT", message_type: "TEXT", text, status: "DELIVERED", retry_count: 0, metadata: {}, created_at: t, updated_at: t } as Message);
  };
  const chat = async (customerId?: string) => {
    seq++;
    const { conversation } = await ConversationService.findOrCreateConversation(tenantId, channelId, "FACEBOOK_MESSENGER", `ext_${stamp}_${seq}`, `th_${stamp}_${seq}`);
    db.updateConversation(tenantId, conversation.id, { mode: "AI", automation_paused: false, ...(customerId ? { customer_id: customerId } : {}) });
    return conversation.id;
  };

  // ================================================================ FX-81
  console.log(`${BOLD}FX-81 tracing, health, alerts${RESET}`);
  let tracedRun = "";
  await runTest("each model call is traced; the traces add up to the run; tool calls carry the trace id", async () => {
    const cid = await chat();
    say(cid, "customer", "black tshirt ache?");
    scripted.steps = [() => ({ tool_calls: [{ id: "c1", name: "search_products", arguments: { query: "black t-shirt" } }] }), () => ({ content: "Ji ache, 650 taka." })];
    const turn = await runCustomerTurn(principalFor(tenantId, cid)!, { traceId: "job_trace_test" });
    tracedRun = turn.runId;
    const run = db.findAgentRunById(tenantId, turn.runId)!;
    const calls = (run.metadata as R).calls as R[];
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls.reduce((n, c) => n + c.prompt, 0), run.input_tokens);
    assert.strictEqual(calls.reduce((n, c) => n + c.completion, 0), run.output_tokens);
    assert.ok(calls.every((c) => c.trace_id === "job_trace_test" && c.prompt_version && c.queue_ms === 2 && c.throttled === 1));
    assert.deepStrictEqual(calls[0].tool_calls, ["search_products"]);
    assert.ok(!JSON.stringify(calls).includes("black tshirt"), "traces hold token counts, not text");
    const tools = db.getAgentToolCalls(tenantId, turn.runId);
    assert.ok(tools.length === 1 && tools[0].trace_id === "job_trace_test");
  });

  await runTest("agent health is computed from recorded runs; GET is platform-only and writes nothing", async () => {
    const run = db.findAgentRunById(tenantId, tracedRun)!;
    const h = computeAgentHealth([run], db.getAgentToolCalls(tenantId, tracedRun));
    assert.strictEqual(h.turns, 1);
    assert.strictEqual(h.model_calls, 2);
    assert.strictEqual(h.throttled_429, 2);
    assert.strictEqual(h.cache_hit_share, Math.round((80 / 240) * 1000) / 10);
    assert.strictEqual(h.tool_failure_rate, 0);
    const mod = await import("@/app/api/v1/platform/ai/agent-health/route");
    const denied = await mod.GET(new Request(`${BASE}/platform/ai/agent-health`, { headers: { authorization: `Bearer ${await signSessionToken({ userId: reg.user.id, tenantId, role: "OWNER", email: reg.user.email, name: reg.user.name, sv: 1 })}` } }));
    assert.ok(denied.status === 401 || denied.status === 403, `a workspace session can't read platform health (${denied.status})`);
  });

  await runTest("guard alerts open one platform incident, not one per check", async () => {
    const before = db.getPlatformIncidents().length;
    const now = Date.now();
    db.createAgentRun({ id: `run_alert_${stamp}`, tenant_id: tenantId, conversation_id: "c", agent_type: "CUSTOMER_AGENT", status: "COMPLETED", current_step: "RESPOND", model: "m", prompt_version: "p", started_at: new Date(now - 60_000).toISOString(), completed_at: new Date(now).toISOString(), latency_ms: 1000, input_tokens: 1, output_tokens: 1, estimated_cost_usd: 0, estimated_cost_bdt: 0, tool_calls_count: 0, created_at: new Date(now).toISOString(), metadata: { guards: ["number_removed"] } } as never);
    assert.ok(AgentHealthService.evaluateAlerts(now).some((a) => a.title.includes("number_removed")));
    AgentHealthService.raiseAlerts(now);
    AgentHealthService.raiseAlerts(now + 1000);
    const opened = db.getPlatformIncidents().slice(before).filter((i) => i.title.includes("number_removed"));
    assert.strictEqual(opened.length, 1);
    assert.deepStrictEqual(opened[0].affected_components, ["customer-agent"]);
  });

  // ================================================================ FX-82
  console.log(`\n${BOLD}FX-82 RAG fixes${RESET}`);
  await runTest("the same upload twice leaves one document and one set of chunks; a change replaces them", async () => {
    const doc = { title: "Delivery Policy", document_type: "SHIPPING_POLICY" as never, raw_content: "## Delivery time\nInside Dhaka 1-2 days. Outside Dhaka 3-5 days." };
    const a = await KnowledgeService.ingestDocument(owner, doc);
    const chunks = db.getKnowledgeChunks(tenantId, a.id).length;
    const b = await KnowledgeService.ingestDocument(owner, doc);
    assert.strictEqual(b.id, a.id);
    assert.strictEqual(db.getKnowledgeDocuments(tenantId).filter((d) => d.title === "Delivery Policy").length, 1);
    assert.strictEqual(db.getKnowledgeChunks(tenantId, a.id).length, chunks);
    assert.strictEqual(b.version, 1);
    const c = await KnowledgeService.ingestDocument(owner, { ...doc, raw_content: doc.raw_content + "\n\n## Cash on delivery\nCOD in all 64 districts." });
    assert.strictEqual(c.id, a.id);
    assert.strictEqual(c.version, 2);
    const after = db.getKnowledgeChunks(tenantId, a.id);
    assert.ok(after.length > chunks && after.every((x) => x.metadata.version === 2), "old chunks are gone");
    const child = after.find((x) => x.chunk_type !== "PARENT")!;
    assert.ok(child.metadata.updated_at && child.metadata.source === "SHIPPING_POLICY:Delivery Policy" && child.metadata.embedding_model === "scripted");
  });

  await runTest("policy search returns at most 2 distinct active documents with no score cutoff", async () => {
    await KnowledgeService.ingestDocument(owner, { title: "Return Policy", document_type: "RETURN_POLICY" as never, raw_content: "## Returns\nUnused items within 7 days." });
    const archived = await KnowledgeService.ingestDocument(owner, { title: "Old Offers", document_type: "FAQ" as never, raw_content: "## Delivery\nDelivery is free (old offer)." });
    await KnowledgeService.archiveDocument(owner, archived.id);
    const docs = await KnowledgeService.searchPolicyDocuments(tenantId, "delivery koto din", 2);
    assert.ok(docs.length >= 1 && docs.length <= 2);
    assert.strictEqual(new Set(docs.map((d) => d.document_id)).size, docs.length);
    assert.ok(docs.every((d) => d.title !== "Old Offers"), "archived documents never come back");
    await KnowledgeService.ingestDocument(owner, { title: "Supplier Terms", document_type: "FAQ" as never, raw_content: "## Delivery\nOur courier cost is 40 per parcel (internal).", customer_visible: false });
    const again = await KnowledgeService.searchPolicyDocuments(tenantId, "delivery courier cost parcel", 2);
    assert.ok(again.every((d) => d.title !== "Supplier Terms"), "staff-only documents never reach customers");
    assert.strictEqual(docs[0].title, "Delivery Policy");
    const tool = await runCustomerTool(principalFor(tenantId, await chat())!, "search_policy", { query: "gift wrapping?" });
    assert.ok(tool.ok && Array.isArray((tool.result as R).results), "the closest documents come back; the agent decides relevance");
  });

  await runTest("Bangla questions get an English sub-query; expansions carry no delivery amounts", async () => {
    assert.match(banglaSubQuery("ঢাকার বাইরে ডেলিভারি কত দিনে হয়?") ?? "", /outside Dhaka/);
    assert.match(banglaSubQuery("ডেলিভারি ফি কত?") ?? "", /delivery charge/);
    assert.strictEqual(banglaSubQuery("delivery charge?"), undefined);
    const src = fs.readFileSync(path.join(process.cwd(), "src/domains/ai/rag/agentic-rag.controller.ts"), "utf8");
    assert.ok(!/fee 120|charge 60/.test(src), "no hard-coded fees in query expansion (F26)");
  });

  await runTest("the re-index job re-embeds chunks made with another model; embedding failures are retried and counted", async () => {
    const chunk = db.getAllTenantKnowledgeChunks(tenantId).find((c) => c.chunk_type !== "PARENT")!;
    chunk.metadata = { ...chunk.metadata, embedding_model: "old-provider/old-model" };
    const r = await KnowledgeService.reembedStaleChunks({ tenantId });
    assert.ok(r.reembedded >= 1 && r.failed === 0);
    assert.strictEqual(db.findKnowledgeChunkById(tenantId, chunk.id)!.metadata.embedding_model, "scripted");
    resetEmbeddingMetrics();
    const original = scripted.embed.bind(scripted);
    let calls = 0;
    scripted.embed = async (t: string) => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("flaky"), { code: "LLM_PROVIDER_ERROR" });
      return original(t);
    };
    await EmbeddingService.embedText("retry me");
    assert.strictEqual(calls, 3);
    scripted.embed = async () => {
      throw Object.assign(new Error("down"), { code: "LLM_PROVIDER_ERROR" });
    };
    await assert.rejects(EmbeddingService.embedText("fail me"));
    scripted.embed = original;
    const m = embeddingMetrics();
    assert.strictEqual(m.calls, 2);
    assert.strictEqual(m.failures, 1);
    assert.ok(m.retries >= 4);
  });

  // ================================================================ FX-83
  console.log(`\n${BOLD}FX-83 retention and erasure${RESET}`);
  await runTest("stored tool calls keep only the last 3 digits of a phone and no street address", () => {
    assert.strictEqual(maskPhone("01711000001"), "********001");
    assert.strictEqual(maskPhone("+880 1711-000001"), "********001");
    assert.ok(PIIRedactionService.redactText("call 01711000001").includes("********001"));
    const red = redactToolPayload({ phone: "01711000001", address_line: "House 12, Road 5", district: "Dhaka", note: "my number is 01822000002", quantity: 2 });
    assert.deepStrictEqual(red, { phone: "********001", address_line: "[address removed]", district: "Dhaka", note: "my number is ********002", quantity: 2 });
    assert.strictEqual(redactToolPayload({ ref: "ord_1759812345678_x", n: "01711000001234" }).ref, "ord_1759812345678_x", "ids keep their digits");
    db.createAgentToolCall({ id: `tc_${stamp}`, tenant_id: tenantId, agent_run_id: "r", conversation_id: "c", tool_name: "place_order", input_arguments: { phone: "01711000001", address_line: "House 12" }, sanitized_result: { customer_phone: "01711000001" }, status: "SUCCESS", duration_ms: 1, created_at: new Date().toISOString() });
    const stored = db.getAgentToolCalls(tenantId, "r").find((t) => t.id === `tc_${stamp}`)!;
    assert.ok(!JSON.stringify(stored).includes("01711000001") && !JSON.stringify(stored).includes("House 12"));
  });

  await runTest("nightly purge: old payloads, shadow drafts and finished jobs go; messages only with a retention period", async () => {
    const now = Date.now();
    const old = new Date(now - 40 * DAY).toISOString();
    db.createAgentToolCall({ id: `tc_old_${stamp}`, tenant_id: tenantId, agent_run_id: "r_old", conversation_id: "c", tool_name: "search_products", input_arguments: { query: "x" }, status: "SUCCESS", duration_ms: 1, created_at: old });
    const cid = await chat();
    db.updateConversation(tenantId, cid, { metadata: { agent_shadow_reply: { text: "draft", at: old } } });
    db.saveAgentJob({ id: `job_old_${stamp}`, tenant_id: tenantId, conversation_id: cid, status: "DONE", not_before: old, last_message_id: "m", attempts: 1, created_at: old, updated_at: old });
    db.data.agent_jobs.find((j) => j.id === `job_old_${stamp}`)!.updated_at = old;
    say(cid, "customer", "old message");
    db.data.messages.find((m) => m.text === "old message")!.created_at = old;
    const r = RetentionService.purge(now, {} as NodeJS.ProcessEnv);
    assert.ok(r.tool_payloads_cleared >= 1 && r.shadow_replies_removed === 1 && r.agent_jobs_deleted >= 1);
    assert.strictEqual(r.messages_deleted, 0, "no retention period set: messages stay");
    assert.deepStrictEqual(db.getAgentToolCalls(tenantId, "r_old")[0].input_arguments, {});
    const withPolicy = RetentionService.purge(now, { CUSTOMER_DATA_RETENTION_DAYS: "30" } as NodeJS.ProcessEnv);
    assert.ok(withPolicy.messages_deleted >= 1);
    assert.ok(!db.data.messages.some((m) => m.text === "old message"));
    // Delivered outbox rows and job results older than 30 days go too
    db.data.domain_events.push({ id: `evt_old_${stamp}`, tenant_id: tenantId, type: "order.placed", source_type: "order.created", aggregate_type: "order", aggregate_id: "o", occurred_at: old, payload: {}, status: "DISPATCHED", attempts: 1, next_attempt_at: old, dispatched_at: old, created_at: old, updated_at: old });
    db.data.job_runs.push({ id: `monitoring:${old}`, job: "monitoring", bucket: old, status: "DONE", started_at: old, result: {} });
    const again = RetentionService.purge(now, {} as NodeJS.ProcessEnv);
    assert.ok(again.outbox_rows_deleted >= 1 && again.job_runs_deleted >= 1);
  });

  const ownerSession = async () => signSessionToken({ userId: reg.user.id, tenantId, role: "OWNER", email: reg.user.email, name: reg.user.name, sv: db.findUserById(reg.user.id)?.session_version ?? 1 });
  const eraseCall = async (customerId: string, body: unknown, extra: Record<string, string> = {}) =>
    (await import("@/app/api/v1/customers/[id]/erase/route")).POST(
      new Request(`${BASE}/customers/${customerId}/erase`, { method: "POST", headers: { authorization: `Bearer ${await ownerSession()}`, "content-type": "application/json", ...extra }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: customerId }) }
    );
  const stepUp = async () => ({ "x-step-up-token": await signStepUpToken(reg.user.id, `${WORKSPACE_STEP_UP_PREFIX}CUSTOMER_ERASE`, db.findUserById(reg.user.id)?.session_version ?? 1) });

  await runTest("erasure always needs a fresh step-up (no grace period), the owner role, a reason and the typed confirmation", async () => {
    const o = await OrderService.createOrder(owner, { customer: { first_name: "Step", last_name: "Up", phone: "01933000003" }, delivery_address: { district: "Dhaka", address_line_1: "Road 1" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    delete process.env.WORKSPACE_STEP_UP_ENFORCED_FROM; // the grace period that other step-ups get
    const noMfa = await eraseCall(o.customer_id, { confirm: "ERASE", reason: "customer asked" });
    assert.strictEqual(noMfa.status, 403);
    assert.strictEqual(((await noMfa.json()) as R).error.code, "MFA_ENROLLMENT_REQUIRED");
    db.updateUser(reg.user.id, { mfa_enabled: true } as never);
    const noStepUp = await eraseCall(o.customer_id, { confirm: "ERASE", reason: "customer asked" });
    assert.strictEqual(noStepUp.status, 403, "step-up required even with enforcement not started");
    assert.strictEqual((await eraseCall(o.customer_id, { confirm: "ERASE" }, await stepUp())).status, 400, "a reason is required");
    assert.strictEqual((await eraseCall(o.customer_id, { confirm: "yes", reason: "customer asked" }, await stepUp())).status, 400);
    assert.strictEqual((await eraseCall(o.customer_id, { confirm: "ERASE", reason: "customer asked", tenant_id: "x" }, await stepUp())).status, 400, "strict body");
    const admin = ctxFor(reg.tenant, reg.user, "ADMIN");
    assert.throws(() => CustomerErasureService.erase(admin, o.customer_id, "x".repeat(10)), (e: R) => e.statusCode === 403);
    // Another workspace's owner can't reach this customer
    const other = await AuthService.registerTenantWithOwner({ workspaceName: "Other Erase Shop", name: "Other Owner", email: `s3e-${stamp}@example.com`, password: "Stage3-Test-Pass-2026!", currency: "BDT" });
    assert.throws(() => CustomerErasureService.erase({ ...ctxFor(other.tenant, other.user), stepUpVerified: true }, o.customer_id, "not mine"), (e: R) => e.statusCode === 404);
    assert.strictEqual(db.findCustomerById(tenantId, o.customer_id)?.first_name, "Step", "untouched");
  });

  await runTest("erasure: afterwards no record holds the customer's phone, name or email; order totals stay; audit has the reason", async () => {
    const order = await OrderService.createOrder(owner, { customer: { first_name: "Rahim", last_name: "Uddin", phone: "01711000001", email: "rahim.uddin@example.com" }, delivery_address: { district: "Dhaka", address_line_1: "House 12, Road 5, Mirpur 10" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    const customerId = order.customer_id;
    const cid = await chat(customerId);
    say(cid, "customer", "ami Rahim Uddin, number 01711000001, House 12 Road 5 Mirpur 10");
    say(cid, "agent", "Dhonnobad Rahim Uddin, apnar number ০১৭১১০০০০০১ note korlam");
    db.updateConversation(tenantId, cid, { metadata: { agent_shadow_reply: { text: "Rahim Uddin 01711000001", at: new Date().toISOString() } } });
    db.data.conversation_summaries.push({ id: `sum_${stamp}`, tenant_id: tenantId, conversation_id: cid, summary_text: "Rahim from Mirpur wants a t-shirt", key_facts: ["lives in Mirpur"] } as never);
    const res = await eraseCall(customerId, { confirm: "ERASE", reason: "customer request by phone" }, await stepUp());
    assert.strictEqual(res.status, 200, await res.clone().text());
    const snapshot = JSON.stringify(db.data);
    for (const needle of ["01711000001", "1711000001", "০১৭১১০০০০০১", "Rahim Uddin", "rahim.uddin@example.com", "House 12", "Rahim from Mirpur"]) {
      if (snapshot.includes(needle)) {
        const where = Object.entries(db.data as unknown as Record<string, unknown[]>).filter(([, v]) => Array.isArray(v) && JSON.stringify(v).includes(needle)).map(([k, v]) => `${k}: ${JSON.stringify((v as unknown[]).find((x) => JSON.stringify(x).includes(needle))).slice(0, 300)}`);
        assert.fail(`"${needle}" is still in the store: ${where.join(" | ")}`);
      }
    }
    const kept = db.findOrderById(tenantId, order.id)!;
    assert.strictEqual(kept.grand_total, order.grand_total);
    assert.strictEqual((kept.shipping_address_snapshot as R).district, "Dhaka");
    const audit = db.data.audit_logs.filter((l) => l.action === "CUSTOMER_ERASED" && l.resource_id === customerId);
    assert.strictEqual(audit.length, 1);
    assert.strictEqual(audit[0].metadata.reason, "customer request by phone");
    assert.ok((audit[0].metadata.deleted as R).conversation_summaries === 1);
  });

  await runTest("erasure never touches the catalog, knowledge, credentials, other customers or single words", async () => {
    const ali = await OrderService.createOrder(owner, { customer: { first_name: "Order", last_name: "", phone: "01644000004" }, delivery_address: { district: "Dhaka", address_line_1: "Road 9" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    const keep = await OrderService.createOrder(owner, { customer: { first_name: "Ali", last_name: "Hasan", phone: "01555000005" }, delivery_address: { district: "Dhaka", address_line_1: "Road 7" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    db.data.customer_identities.push({ id: `idn_${stamp}`, tenant_id: tenantId, customer_id: ali.customer_id, channel_id: channelId, channel_type: "FACEBOOK_MESSENGER", external_user_id: `psid_${stamp}`, display_name: "the", metadata: {}, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() } as never);
    const freeze = () => JSON.stringify({
      products: db.data.products.filter((x) => x.tenant_id === tenantId), chunks: db.data.knowledge_chunks.filter((x) => x.tenant_id === tenantId),
      channels: db.data.connected_channels.filter((x) => x.tenant_id === tenantId), other: db.findCustomerById(tenantId, keep.customer_id), otherOrder: db.findOrderById(tenantId, keep.id),
      platform: db.data.platform_audit_logs,
    });
    const before = freeze();
    CustomerErasureService.erase({ ...owner, stepUpVerified: true }, ali.customer_id, "testing single-word names");
    assert.strictEqual(freeze(), before);
  });

  await runTest("another customer with the same two-word name keeps it in their own chat", async () => {
    const a = await OrderService.createOrder(owner, { customer: { first_name: "Md", last_name: "Karim", phone: "01366000006" }, delivery_address: { district: "Dhaka", address_line_1: "Road 3" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    const b = await OrderService.createOrder(owner, { customer: { first_name: "Md", last_name: "Karim", phone: "01377000007" }, delivery_address: { district: "Dhaka", address_line_1: "Road 4" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    const chatA = await chat(a.customer_id);
    const chatB = await chat(b.customer_id);
    say(chatA, "customer", "ami Md Karim");
    say(chatB, "customer", "ami Md Karim, onno jon");
    CustomerErasureService.erase({ ...owner, stepUpVerified: true }, a.customer_id, "same-name test");
    assert.ok(db.getMessages(tenantId, chatB, { limit: 10 }).messages.some((m) => m.text === "ami Md Karim, onno jon"));
    assert.ok(!db.getMessages(tenantId, chatA, { limit: 10 }).messages.some((m) => m.text.includes("Karim")));
  });

  // ================================================================ FX-84
  console.log(`\n${BOLD}FX-84 atomic handoff and context card${RESET}`);
  await runTest("if the handoff note can't be written, the chat stays with the bot", async () => {
    const cid = await chat();
    const original = MessageService.createInternalNote;
    MessageService.createInternalNote = async () => {
      throw new Error("note store down");
    };
    try {
      await assert.rejects(new RequestHumanHandoffTool().execute(owner, { reason: "angry", summary: "x", priority: "HIGH" }, { conversationId: cid }));
    } finally {
      MessageService.createInternalNote = original;
    }
    const c = db.findConversationById(tenantId, cid)!;
    assert.strictEqual(c.mode, "AI");
    assert.strictEqual(c.automation_paused, false);
  });

  await runTest("the card holds reason, slots, open quote, orders, script and an SLA, and renders in the inbox", async () => {
    const cid = await chat();
    say(cid, "customer", "আমার নাম করিম, ঢাকা, black tshirt L size");
    const pr = principalFor(tenantId, cid)!;
    const q = await runCustomerTool(pr, "quote_order", { items: [{ variant_id: variantId, quantity: 1 }], district: "Dhaka" });
    assert.ok(q.ok);
    const out = await runCustomerTool(pr, "handoff_to_human", { reason: "payment_problem", summary: "Charged twice" });
    assert.ok(out.ok);
    const card = db.findConversationById(tenantId, cid)!.metadata.handoff_card as R;
    assert.strictEqual(card.reason, "payment_problem");
    assert.strictEqual(card.intent, "payment issue");
    assert.strictEqual(card.priority, "HIGH");
    assert.ok(card.slots.some((s: string) => s.startsWith("district: Dhaka")));
    assert.strictEqual(card.open_quote.grand_total, (q.result as R).grand_total_bdt);
    assert.strictEqual(card.script, "bangla");
    assert.ok(Date.parse(card.sla_due_at) - Date.parse(card.created_at) === 15 * 60_000);
    // Render with a CSS-module stub (no DOM needed)
    (require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions[".css"] = (m) => {
      m.exports = new Proxy({}, { get: (_t, k) => String(k) });
    };
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { HandoffContextCard, isHandoffCard } = await import("@/components/social/HandoffContextCard");
    assert.ok(isHandoffCard(card));
    const html = renderToStaticMarkup(React.createElement(HandoffContextCard, { card: card as never }));
    assert.ok(html.includes("payment issue") && html.includes("Charged twice") && html.includes("HIGH") && html.includes("unverified"), html);
  });

  // ================================================================ FX-85
  console.log(`\n${BOLD}FX-85 no unwritten memory${RESET}`);
  await runTest("no code reads a memory collection that nothing writes", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(fs.readFileSync(p, "utf8"));
      }
    };
    walk(path.join(process.cwd(), "src"));
    const all = files.join("\n");
    for (const [reader, writer] of [["getCustomerMemory", "saveCustomerMemory"], ["getConversationSummary", "saveConversationSummary"]]) {
      const reads = (all.match(new RegExp(`\\.${reader}\\(`, "g")) || []).length;
      const writes = (all.match(new RegExp(`\\.${writer}\\(`, "g")) || []).length;
      assert.ok(reads === 0 || writes > 0, `${reader} is read ${reads} times but ${writer} is never called`);
    }
    assert.ok(!/customer_memory/.test(fs.readFileSync(path.join(process.cwd(), "src/domains/ai/context/context-builder.ts"), "utf8")));
  });

  // ================================================================ FX-99 Part B
  console.log(`\n${BOLD}FX-99 Part B outbox and jobs${RESET}`);
  let placedOrderId = "";
  await runTest("placing an order writes its outbox row together with the event", async () => {
    const o = await OrderService.createOrder(owner, { customer: { first_name: "Karim", last_name: "Ahmed", phone: "01822000002" }, delivery_address: { district: "Sylhet", address_line_1: "Flat 3B" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD" } as never);
    placedOrderId = o.id;
    const rows = db.getAllDomainEvents().filter((e) => e.aggregate_id === o.id);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, "order.placed");
    assert.strictEqual(rows[0].source_type, "order.created");
    assert.ok(db.data.events.some((e) => e.id === rows[0].id), "same id as the recorded event");
    assert.ok(!JSON.stringify(rows[0].payload).includes("01822000002"), "no raw phone in the outbox");
  });

  await runTest("the dispatcher delivers each event once, in order per order", async () => {
    // A second event for the same order, then deliver
    db.recordEvent({ id: `evt_deliv_${stamp}`, type: "order.delivered", version: "1.0", tenant_id: tenantId, aggregate_type: "order", aggregate_id: placedOrderId, timestamp: new Date(Date.now() + 1000).toISOString(), payload: {} });
    const seen: string[] = [];
    const original = AutomationRouterService.routeEvent;
    AutomationRouterService.routeEvent = async (event) => {
      seen.push(`${event.aggregate_id}:${event.type}`);
      return [];
    };
    try {
      const first = await dispatchOutboxOnce();
      assert.ok(first.delivered >= 1);
      assert.ok(!seen.includes(`${placedOrderId}:order.delivered`), "the later event waits for the earlier one");
      await dispatchOutboxOnce();
      await dispatchOutboxOnce();
    } finally {
      AutomationRouterService.routeEvent = original;
    }
    const mine = seen.filter((s) => s.startsWith(placedOrderId));
    assert.deepStrictEqual(mine, [`${placedOrderId}:order.placed`, `${placedOrderId}:order.delivered`]);
    assert.ok(db.getAllDomainEvents().filter((e) => e.aggregate_id === placedOrderId).every((e) => e.status === "DISPATCHED"));
  });

  await runTest("a failing delivery is retried with backoff, then dead after 5 attempts; a kill-switch cancel isn't retried", async () => {
    db.recordEvent({ id: `evt_fail_${stamp}`, type: "shipment.updated", version: "1.0", tenant_id: tenantId, aggregate_type: "shipment", aggregate_id: `shp_${stamp}`, timestamp: new Date().toISOString(), payload: {} });
    db.recordEvent({ id: `evt_cancel_${stamp}`, type: "shipment.updated", version: "1.0", tenant_id: tenantId, aggregate_type: "shipment", aggregate_id: `shp_c_${stamp}`, timestamp: new Date().toISOString(), payload: {} });
    const original = AutomationRouterService.routeEvent;
    AutomationRouterService.routeEvent = async (event) =>
      event.id === `evt_cancel_${stamp}` ? [{ automationId: "a", workflowId: "w", executionId: "x", status: "CANCELLED", success: false }] : [{ automationId: "a", workflowId: "w", executionId: "x", status: "FAILED", success: false }];
    try {
      let t = Date.now();
      for (let i = 0; i < MAX_DISPATCH_ATTEMPTS; i++) {
        await dispatchOutboxOnce(20, t);
        const row = db.findDomainEvent(tenantId, `evt_fail_${stamp}`)!;
        if (i < MAX_DISPATCH_ATTEMPTS - 1) assert.ok(row.status === "PENDING" && row.next_attempt_at > new Date(t).toISOString());
        t = Date.parse(row.next_attempt_at) + 1;
      }
    } finally {
      AutomationRouterService.routeEvent = original;
    }
    assert.strictEqual(db.findDomainEvent(tenantId, `evt_fail_${stamp}`)!.status, "DEAD");
    assert.strictEqual(db.findDomainEvent(tenantId, `evt_cancel_${stamp}`)!.status, "DISPATCHED");
    // A dead row holds back later events of the same shipment
    db.recordEvent({ id: `evt_after_dead_${stamp}`, type: "shipment.updated", version: "1.0", tenant_id: tenantId, aggregate_type: "shipment", aggregate_id: `shp_${stamp}`, timestamp: new Date(Date.now() + 5000).toISOString(), payload: {} });
    assert.ok(!db.getDueDomainEvents(new Date(Date.now() + DAY).toISOString(), new Date(0).toISOString(), 100).some((e) => e.id === `evt_after_dead_${stamp}`));
  });

  await runTest("stock falling to its reorder point records one low-stock event", async () => {
    const item = db.data.inventory_items.find((i) => i.tenant_id === tenantId && i.product_variant_id === variantId)!;
    item.reorder_point = 5;
    // Restock well above the reorder point first (earlier tests' orders used some up)
    db.adjustStock(tenantId, { warehouse_id: item.warehouse_id, product_variant_id: variantId, quantity_delta: 20, type: "ADJUSTMENT" as never, reason: "restock", actor_user_id: reg.user.id });
    const before = db.getAllDomainEvents().filter((e) => e.type === "inventory.low_stock").length;
    db.adjustStock(tenantId, { warehouse_id: item.warehouse_id, product_variant_id: variantId, quantity_delta: -(item.quantity_available - 5), type: "ADJUSTMENT" as never, reason: "count", actor_user_id: reg.user.id });
    db.adjustStock(tenantId, { warehouse_id: item.warehouse_id, product_variant_id: variantId, quantity_delta: -1, type: "ADJUSTMENT" as never, reason: "count", actor_user_id: reg.user.id });
    assert.strictEqual(db.getAllDomainEvents().filter((e) => e.type === "inventory.low_stock").length, before + 1);
  });

  await runTest("job endpoint: off without a configured token, 401 for a wrong one, needs an Idempotency-Key", async () => {
    const mod = await import("@/app/api/v1/jobs/[job]/run/route");
    const call = (token: string | null, key: string | null) =>
      mod.POST(new Request(`${BASE}/jobs/monitoring/run`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { "idempotency-key": key } : {}) } }), { params: Promise.resolve({ job: "monitoring" }) });
    const token = crypto.randomBytes(32).toString("base64url");
    delete process.env.JOBS_TOKEN_SHA256;
    assert.strictEqual((await call(token, "monitoring:1")).status, 503);
    process.env.JOBS_TOKEN_SHA256 = crypto.createHash("sha256").update(token).digest("hex");
    try {
      assert.strictEqual((await call(null, "monitoring:1")).status, 401);
      assert.strictEqual((await call(crypto.randomBytes(32).toString("base64url"), "monitoring:1")).status, 401);
      assert.strictEqual((await call(token, null)).status, 400);
      const ok = await call(token, "monitoring:1");
      assert.strictEqual(ok.status, 200, await ok.clone().text());
      const body = (await ok.json()) as R;
      assert.ok(body.data.outbox && typeof body.data.outbox.dead === "number");
      const session = await signSessionToken({ userId: reg.user.id, tenantId, role: "OWNER", email: reg.user.email, name: reg.user.name, sv: 1 });
      assert.strictEqual((await call(session, "monitoring:1")).status, 401, "a workspace session is not a job token");
      assert.strictEqual((await call("short", "monitoring:1")).status, 401);
    } finally {
      delete process.env.JOBS_TOKEN_SHA256;
    }
  });

  await runTest("each job runs once per bucket; shops are chosen by CommerceOS (opt-in, local time, kill switch)", async () => {
    // 15:00 UTC is 21:00 in Dhaka
    const at = Date.parse("2026-10-07T15:10:00Z");
    assert.strictEqual(localHour({ timezone: "Asia/Dhaka" }, at), 21);
    const tenant = db.findTenantById(tenantId)!;
    db.updateTenant(tenantId, { settings: { ...(tenant.settings as R), daily_report_telegram_chat_id: "-100123" } } as never);
    const other = await AuthService.registerTenantWithOwner({ workspaceName: "Not Opted In", name: "Other Owner", email: `s3o-${stamp}@example.com`, password: "Stage3-Test-Pass-2026!", currency: "BDT" });
    let runs = 0;
    const first = (await JobsService.run("daily-report", "daily-report:a", at)) as R;
    const ids = (first.tenants as R[]).map((t) => t.tenant_id);
    assert.ok(ids.includes(tenantId) && !ids.includes(other.tenant.id), "only opted-in shops");
    assert.strictEqual((first.tenants as R[])[0].telegram_chat_id, "-100123", "the recipient comes from CommerceOS settings");
    const again = (await JobsService.run("daily-report", "daily-report:b", at + 60_000)) as R;
    assert.strictEqual(again.replayed, true);
    assert.deepStrictEqual(again.tenants, first.tenants);
    assert.strictEqual(bucketOf("daily-report", at), bucketOf("daily-report", at + 60_000));
    runs++;
    db.savePlatformKillSwitch({ id: `ks_job_${stamp}`, scope: "TENANT", target_id: tenantId, is_active: true, reason: "test", activated_by_user_id: "op", updated_at: new Date().toISOString() } as never);
    const killed = (await JobsService.run("daily-report", "daily-report:c", at + 60 * 60_000 * 24)) as R;
    db.savePlatformKillSwitch({ ...db.findPlatformKillSwitch(`ks_job_${stamp}`)!, is_active: false });
    assert.ok(!(killed.tenants as R[]).some((t) => t.tenant_id === tenantId), "a paused shop is skipped");
    assert.strictEqual(runs, 1);
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
