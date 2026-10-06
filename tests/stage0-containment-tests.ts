/**
 * Stage 0 containment (AI fix plan FX-67, FX-68, FX-69, FX-70, FX-71, FX-88; audit F01, F03, F04, F05, F06, F14, F24).
 * Every test here failed, or could not be written, against the code before the fix.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { MessageService } from "@/domains/social/messages/message.service";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { toolRegistry } from "@/domains/ai/tools/tool-registry";
import { LLM_FORBIDDEN_TOOLS, COPILOT_READ_ONLY_TOOLS } from "@/domains/ai/tools/tool-access";
import { ModelRouter, modelRouter } from "@/domains/ai/providers/model-router";
import { OpenAICompatibleProvider } from "@/domains/ai/providers/openai-compatible.provider";
import type { LLMMessage, LLMProvider, LLMResponse, LLMToolDefinition, LLMUsage } from "@/domains/ai/providers/llm-provider.interface";
import { ContextBuilder } from "@/domains/ai/context/context-builder";
import { CustomerSupportAgent } from "@/domains/ai/agents/customer-support.agent";
import { SalesAgent } from "@/domains/ai/agents/sales.agent";
import { OrderAssistantAgent } from "@/domains/ai/agents/order-assistant.agent";
import { ProductInfoAgent } from "@/domains/ai/agents/product-info.agent";
import { AgentRuntime } from "@/domains/ai/runtime/agent-runtime";
import { CopilotService } from "@/domains/ai/copilot/copilot.service";
import { PromptRegistry } from "@/domains/ai/prompts/prompt-registry";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { paymentOperationsService } from "@/domains/operations/services/payment-operations.service";
import { setOutboundLookupForTesting, setOutboundTransportForTesting } from "@/lib/outbound-http";
import { signSessionToken } from "@/lib/security";
import type { PriceChangeRequest } from "@/types/operations";

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

/** A provider that returns scripted tool calls, then a plain answer. */
class ScriptedProvider implements LLMProvider {
  public readonly providerName = "scripted";
  public calls = 0;
  constructor(private readonly script: Array<{ tool?: string; args?: Record<string, unknown>; text?: string }>) {}
  private usage(): LLMUsage {
    return { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  }
  public async chat(_messages: LLMMessage[], _tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls++;
    if (step.tool) {
      return { content: "", tool_calls: [{ id: `call_${this.calls}`, name: step.tool, arguments: step.args ?? {} }], usage: this.usage(), model: "scripted", latency_ms: 1 };
    }
    return { content: step.text ?? "done", tool_calls: [], usage: this.usage(), model: "scripted", latency_ms: 1 };
  }
  public async generate(): Promise<string> {
    return "done";
  }
  public async structuredOutput<T>(): Promise<{ data: T; usage: LLMUsage; latency_ms: number }> {
    throw new Error("not used");
  }
  public async embed(): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }
}

function ownerContext(tenant: { id: string; name: string; slug: string }, user: { id: string; email: string; name: string }): RequestContext {
  return {
    requestId: `req_s0_${tenant.id}`,
    traceId: `tr_s0_${tenant.id}`,
    user: { id: user.id, email: user.email, name: user.name, status: "ACTIVE" },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  console.log(`\n${BOLD}STAGE 0 CONTAINMENT (FX-67 … FX-71, FX-88)${RESET}\n`);
  db.clearAllForTesting();

  const now = Date.now();
  const reg = await AuthService.registerTenantWithOwner({
    workspaceName: `Stage0 Shop ${now}`,
    name: "Stage0 Owner",
    email: `stage0-${now}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });
  const ctx = ownerContext(reg.tenant, reg.user);
  const tenantId = ctx.tenant.id;
  db.ensureDefaultSeed(tenantId);

  const channel = await ChannelService.connectChannel(ctx, {
    type: "FACEBOOK_MESSENGER",
    name: "Stage0 Page",
    provider_account_id: "page_s0_100",
    credentials: { pageId: "page_s0_100", accessToken: "tok_s0" },
  });
  const { conversation } = await ConversationService.findOrCreateConversation(tenantId, channel.id, "FACEBOOK_MESSENGER", "cust_s0_001", "ext_s0_thread");
  db.updateConversation(tenantId, conversation.id, { mode: "BOT", automation_paused: false });

  const product = await ProductService.createProduct(ctx, {
    name: "Stage0 Panjabi",
    sku: "S0-PANJ",
    base_price: 2500,
    variants: [
      { title: "Size 40", sku: "S0-PANJ-40", price: 2500, initial_stock: 7, attributes: { size: "40" } },
      { title: "Size 42", sku: "S0-PANJ-42", price: 2500, initial_stock: 0, attributes: { size: "42" } },
    ],
  });
  const variant = product.variants![0];

  const priceRequest = (status: PriceChangeRequest["status"]): PriceChangeRequest =>
    db.createPriceChangeRequest({
      id: `pcr_s0_${status}_${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: tenantId,
      product_variant_id: variant.id,
      sku: variant.sku,
      old_price: 2500,
      new_price: 1,
      margin_percent: -99,
      reason: "stage0 test",
      status,
      created_at: new Date().toISOString(),
    });

  const restoreRouter = () => ModelRouter.getInstance().configure(process.env);

  // ------------------------------------------------------------------ FX-67
  console.log(`${BOLD}[FX-67] Server-side tool allowlist${RESET}`);

  await runTest("a tool that isn't on the caller's list is refused and the refusal is recorded", async () => {
    const runId = `run_s0_allow_${Date.now()}`;
    const res = await toolRegistry.executeTool(ctx, {
      toolName: "search_products",
      arguments: { query: "Panjabi" },
      agentRunId: runId,
      conversationId: conversation.id,
      allowedTools: ["get_order_status"],
    });
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.startsWith("TOOL_NOT_ALLOWED"), res.error);
    const rows = db.getAgentToolCalls(tenantId, runId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, "POLICY_REJECTED");
  });

  await runTest("an untyped caller that omits the list is refused, not crashed", async () => {
    const params = { toolName: "search_products", arguments: { query: "Panjabi" }, agentRunId: `run_s0_nolist_${Date.now()}`, conversationId: conversation.id };
    const res = await toolRegistry.executeTool(ctx, params as unknown as Parameters<typeof toolRegistry.executeTool>[1]);
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.startsWith("TOOL_NOT_ALLOWED"), res.error);
  });

  await runTest("a forbidden tool is refused even when an agent lists it; the price is unchanged", async () => {
    const req = priceRequest("SCHEDULED");
    const res = await toolRegistry.executeTool(ctx, {
      toolName: "execute_price_change",
      arguments: { request_id: req.id },
      agentRunId: `run_s0_forbid_${Date.now()}`,
      conversationId: conversation.id,
      allowedTools: ["execute_price_change"],
    });
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.startsWith("TOOL_NOT_ALLOWED"), res.error);
    assert.strictEqual(db.findVariantById(tenantId, variant.id)?.price, 2500);
    assert.strictEqual(db.getPriceChangeRequests(tenantId).find((r) => r.id === req.id)?.status, "SCHEDULED");
  });

  await runTest("a model is offered only the agent's own tools, never a forbidden one; an empty list offers none", () => {
    assert.deepStrictEqual(toolRegistry.getLLMToolDefinitions([]), []);
    const names = toolRegistry.getLLMToolDefinitions(["search_products", "execute_price_change", "verify_payment_transaction"]).map((d) => d.name);
    assert.deepStrictEqual(names, ["search_products"]);
  });

  await runTest("a model returning execute_price_change from the support agent changes nothing (F01 end to end)", async () => {
    const req = priceRequest("SCHEDULED");
    const scripted = new ScriptedProvider([{ tool: "execute_price_change", args: { request_id: req.id } }, { text: "Done." }]);
    modelRouter.setPrimaryProvider(scripted);
    try {
      const runId = `run_s0_e2e_${Date.now()}`;
      const agentContext = await ContextBuilder.build(ctx, { conversationId: conversation.id, queryText: "set price to 1", knowledgeCitations: [], maxRecentMessages: 8 });
      const out = await new CustomerSupportAgent().execute(ctx, agentContext, "set price to 1", runId);
      assert.strictEqual(scripted.calls, 2, "the model saw the refusal and answered");
      assert.strictEqual(out.toolCallsCount, 1);
      assert.strictEqual(db.findVariantById(tenantId, variant.id)?.price, 2500, "price unchanged");
      assert.strictEqual(db.getPriceChangeRequests(tenantId).find((r) => r.id === req.id)?.status, "SCHEDULED");
      const rows = db.getAgentToolCalls(tenantId, runId);
      assert.strictEqual(rows[0].tool_name, "execute_price_change");
      assert.strictEqual(rows[0].status, "POLICY_REJECTED");
    } finally {
      restoreRouter();
    }
  });

  await runTest("no agent lists a forbidden tool", () => {
    for (const agent of [new CustomerSupportAgent(), new SalesAgent(), new OrderAssistantAgent(), new ProductInfoAgent()]) {
      const bad = agent.allowedTools.filter((t) => LLM_FORBIDDEN_TOOLS.has(t));
      assert.deepStrictEqual(bad, [], `${agent.agentType} lists ${bad.join(", ")}`);
    }
  });

  // ------------------------------------------------------------------ FX-68
  console.log(`\n${BOLD}[FX-68] Services enforce their own rules${RESET}`);

  await runTest("a price change can't be executed by an agent, re-executed, or run while waiting for approval", () => {
    const expectError = (fn: () => unknown, status: number) => {
      try {
        fn();
      } catch (err) {
        assert.ok(err instanceof AppError, String(err));
        assert.strictEqual(err.statusCode, status, err.message);
        return;
      }
      assert.fail(`expected HTTP ${status}`);
    };
    const scheduled = priceRequest("SCHEDULED");
    expectError(() => pricingOperationsService.executePriceChange(tenantId, scheduled.id, "agent", { actorType: "AGENT" }), 403);
    const pending = priceRequest("PENDING_APPROVAL");
    expectError(() => pricingOperationsService.executePriceChange(tenantId, pending.id, ctx.user.id, { actorType: "USER" }), 409);
    const rejected = priceRequest("REJECTED");
    expectError(() => pricingOperationsService.executePriceChange(tenantId, rejected.id, ctx.user.id, { actorType: "USER", approvedNow: true }), 409);
    assert.strictEqual(db.findVariantById(tenantId, variant.id)?.price, 2500, "nothing ran yet");

    const exec = pricingOperationsService.executePriceChange(tenantId, scheduled.id, ctx.user.id, { actorType: "USER" });
    assert.strictEqual(exec.status, "SUCCESS");
    expectError(() => pricingOperationsService.executePriceChange(tenantId, scheduled.id, ctx.user.id, { actorType: "USER" }), 409);
    db.updateProductVariant(tenantId, variant.id, { price: 2500 }); // reset for the other tests
  });

  await runTest("manual payment verification from an agent is refused before anything is read or written", () => {
    assert.throws(
      () => paymentOperationsService.reconcileTransaction(tenantId, { orderId: "ord_none", transactionId: "8N7A6C5D4E", amount: 100, actor: "agent", actorType: "AGENT" }),
      (err: unknown) => err instanceof AppError && err.statusCode === 403
    );
  });

  await runTest("sending or scheduling a campaign through a tool needs marketing.write, not analytics.read", () => {
    assert.strictEqual(toolRegistry.getTool("send_campaign")?.requiredPermission, PERMISSIONS.MARKETING_WRITE);
    assert.strictEqual(toolRegistry.getTool("schedule_campaign")?.requiredPermission, PERMISSIONS.MARKETING_WRITE);
  });

  // ------------------------------------------------------------------ FX-69
  console.log(`\n${BOLD}[FX-69] The copilot only reads${RESET}`);

  await runTest("with the copilot's tool set, a model asking for create_order_draft creates no order", async () => {
    const ordersBefore = db.getAllOrders(tenantId).length;
    const scripted = new ScriptedProvider([
      { tool: "create_order_draft", args: { customer_phone: "01700000000", items: [{ variant_id: variant.id, quantity: 500 }], shipping_district: "Dhaka" } },
      { text: "Draft ready." },
    ]);
    modelRouter.setPrimaryProvider(scripted);
    try {
      const runId = `run_s0_cop_${Date.now()}`;
      const agentContext = await ContextBuilder.build(ctx, { conversationId: conversation.id, queryText: "order 500 to Mirpur", knowledgeCitations: [], maxRecentMessages: 8 });
      await new SalesAgent().execute(ctx, agentContext, "order 500 to Mirpur", runId, { toolSubset: COPILOT_READ_ONLY_TOOLS });
      assert.strictEqual(db.getAllOrders(tenantId).length, ordersBefore, "no order created");
      assert.strictEqual(db.getAgentToolCalls(tenantId, runId)[0]?.status, "POLICY_REJECTED");
    } finally {
      restoreRouter();
    }
  });

  await runTest("a copilot suggestion reports no confidence and leaves the conversation as it was", async () => {
    await MessageService.processInboundMessage(tenantId, conversation.id, {
      channelType: "FACEBOOK_MESSENGER",
      channelId: channel.id,
      externalEventId: `evt_s0_${Date.now()}`,
      externalMessageId: `msg_s0_${Date.now()}`,
      externalConversationId: "ext_s0_thread",
      externalSenderId: "cust_s0_001",
      direction: "INBOUND",
      messageType: "TEXT",
      text: "I want to talk with a human agent please",
    });
    const ordersBefore = db.getAllOrders(tenantId).length;
    const suggestion = await CopilotService.generateSuggestion(ctx, conversation.id);
    assert.strictEqual(suggestion.confidence, null);
    const conv = db.findConversationById(tenantId, conversation.id);
    assert.strictEqual(conv?.mode, "BOT", "Suggest doesn't hand the conversation off");
    assert.strictEqual(conv?.automation_paused, false);
    assert.strictEqual(db.getAllOrders(tenantId).length, ordersBefore);
  });

  // ------------------------------------------------------------------ FX-70
  console.log(`\n${BOLD}[FX-70] Real cost, cached tokens, versions${RESET}`);

  await runTest("cached prompt tokens are priced at the cached rate", () => {
    const saved = process.env.LLM_PRICING_JSON;
    process.env.LLM_PRICING_JSON = JSON.stringify({ TIER_1_FAST: { promptCostPer1M: 0.15, cachedPromptCostPer1M: 0.014, completionCostPer1M: 0.6 } });
    try {
      const { costUsd } = modelRouter.calculateCost("TIER_1_FAST", 1_000_000, 100_000, 600_000);
      assert.strictEqual(costUsd, 0.1284); // 0.4M × 0.15 + 0.6M × 0.014 + 0.1M × 0.6
      assert.strictEqual(modelRouter.calculateCost("TIER_1_FAST", 1_000_000, 0).costUsd, 0.15, "no cache reported → full price");
    } finally {
      if (saved === undefined) delete process.env.LLM_PRICING_JSON;
      else process.env.LLM_PRICING_JSON = saved;
    }
  });

  await runTest("the provider keeps prompt_tokens_details.cached_tokens", async () => {
    setOutboundLookupForTesting(async () => [{ address: "93.184.216.34", family: 4 }]);
    setOutboundTransportForTesting(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 900, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 800 } } }),
      truncated: false,
      durationMs: 1,
    }));
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: "http://llm.s0/v1", models: { TIER_1_FAST: "m", TIER_2_REASONING: "m", TIER_3_EMBEDDING: "e" } });
      const res = await p.chat([{ role: "user", content: "x" }]);
      assert.strictEqual(res.usage.cached_tokens, 800);
    } finally {
      setOutboundTransportForTesting(null);
      setOutboundLookupForTesting(null);
    }
  });

  await runTest("a router handoff reports no made-up tokens or cost", async () => {
    const out = await AgentRuntime.run(ctx, { conversationId: conversation.id, messageText: "I want to talk with a human agent please", simulateOnly: true });
    assert.strictEqual(out.status, "ESCALATED");
    assert.strictEqual(out.tokensUsed, 0);
    assert.strictEqual(out.costUsd, 0);
    db.updateConversation(tenantId, conversation.id, { mode: "BOT", automation_paused: false });
  });

  await runTest("a run records the prompt version of the agent that answered", async () => {
    const out = await AgentRuntime.run(ctx, { conversationId: conversation.id, messageText: "Panjabi er dam koto?", simulateOnly: true });
    const run = db.findAgentRunById(tenantId, out.runId);
    assert.ok(run, "the run is recorded");
    assert.notStrictEqual(run.current_step, "HUMAN_HANDOFF", "this message reaches an agent");
    assert.strictEqual(run.prompt_version, PromptRegistry.getTemplate(run.agent_type).version);
  });

  // ------------------------------------------------------------------ FX-71
  console.log(`\n${BOLD}[FX-71] Honest stock${RESET}`);

  await runTest("a product with no inventory row is not reported in stock", async () => {
    const bare = await ProductService.createProduct(ctx, { name: "Stage0 Bare Shirt", sku: "S0-BARE", base_price: 900 });
    const variantIds = new Set((bare.variants ?? []).map((v) => v.id));
    db.data.inventory_items = db.data.inventory_items.filter((i) => !variantIds.has(i.product_variant_id));
    const res = (await toolRegistry.execute(ctx, "check_inventory", { product_query: "Stage0 Bare" })) as { status: string; quantity: number; available: boolean };
    assert.strictEqual(res.status, "OUT_OF_STOCK");
    assert.strictEqual(res.quantity, 0);
    assert.strictEqual(res.available, false);
  });

  await runTest("a size the product doesn't come in is SIZE_NOT_OFFERED, not the stock of every size", async () => {
    const res = (await toolRegistry.execute(ctx, "check_inventory", { product_id: product.id, variant_attributes: { size: "44" } })) as {
      status: string;
      offered: string[];
      available: boolean;
    };
    assert.strictEqual(res.status, "SIZE_NOT_OFFERED");
    assert.strictEqual(res.available, false);
    assert.deepStrictEqual(res.offered.sort(), ["Size 40", "Size 42"]);
  });

  await runTest("stock is reported per variant, and an out-of-stock size says so", async () => {
    const res = (await toolRegistry.execute(ctx, "check_inventory", { product_id: product.id, variant_attributes: { size: "42" } })) as {
      status: string;
      variants: Array<{ variant_title: string; stock_status: string }>;
    };
    assert.strictEqual(res.status, "OUT_OF_STOCK");
    assert.deepStrictEqual(res.variants.map((v) => [v.variant_title, v.stock_status]), [["Size 42", "OUT_OF_STOCK"]]);
  });

  // ------------------------------------------------------------------ FX-88
  console.log(`\n${BOLD}[FX-88] Model names only from configuration${RESET}`);

  await runTest("a provider without LLM_MODEL_FAST refuses clearly instead of sending a vendor default", async () => {
    const router = ModelRouter.getInstance();
    try {
      router.configure({ LLM_BASE_URL: "http://llm.s0/v1", LLM_API_KEY: "k", LLM_PROVIDER_NAME: "ollama-cloud" } as NodeJS.ProcessEnv);
      assert.strictEqual(router.getMode(), "NOT_CONFIGURED");
      await assert.rejects(
        router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "x" }]),
        (err: unknown) => err instanceof AppError && err.code === "AI_PROVIDER_NOT_CONFIGURED" && /LLM_MODEL_FAST/.test(err.message)
      );
    } finally {
      restoreRouter();
    }
  });

  await runTest("embeddings without LLM_EMBEDDING_MODEL refuse without calling the provider", async () => {
    const router = ModelRouter.getInstance();
    let outbound = 0;
    setOutboundLookupForTesting(async () => [{ address: "93.184.216.34", family: 4 }]);
    setOutboundTransportForTesting(async () => {
      outbound++;
      return { status: 200, headers: {}, body: "{}", truncated: false, durationMs: 1 };
    });
    try {
      router.configure({ LLM_BASE_URL: "http://llm.s0/v1", LLM_MODEL_FAST: "gpt-oss:120b" } as NodeJS.ProcessEnv);
      assert.strictEqual(router.resolveModelName("TIER_2_REASONING"), "gpt-oss:120b", "reasoning reuses the fast model");
      await assert.rejects(router.generateEmbedding("hello"), (err: unknown) => err instanceof AppError && err.code === "AI_PROVIDER_NOT_CONFIGURED");
      assert.strictEqual(outbound, 0);
    } finally {
      setOutboundTransportForTesting(null);
      setOutboundLookupForTesting(null);
      restoreRouter();
    }
  });

  // ------------------------------------------------------------------ FX-99 Part A
  console.log(`\n${BOLD}[FX-99 Part A] Automation events and notifications${RESET}`);

  type Handler = (request: Request) => Promise<Response>;
  const BASE = "http://localhost:3000/api/v1";
  const member = async (tenant: string, role: "MANAGER" | "ADMIN") => {
    const id = `usr_s0_${role.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
    const email = `${id}@stage0.test`;
    const ts = new Date().toISOString();
    db.createUser({ id, email, name: `S0 ${role}`, password_hash: "!disabled", status: "ACTIVE", created_at: ts, updated_at: ts });
    db.createMembership({ id: `mem_${id}`, tenant_id: tenant, user_id: id, role, created_at: ts, updated_at: ts });
    return { id, token: await signSessionToken({ userId: id, tenantId: tenant, role, email, name: `S0 ${role}` }) };
  };
  const post = (handler: Handler, path: string, token: string, body: unknown, headers: Record<string, string> = {}) =>
    handler(new Request(`${BASE}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }));

  // A second workspace with an active automation on order.created (the victim in F32)
  const victim = await AuthService.registerTenantWithOwner({
    workspaceName: `Stage0 Victim ${now}`,
    name: "Victim Owner",
    email: `stage0-victim-${now}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });
  const victimId = victim.tenant.id;
  const ts = new Date().toISOString();
  const automationFor = (tenant: string, trigger: string, suffix: string) => {
    db.createAutomationWorkflow({
      id: `awf_s0_${suffix}`, tenant_id: tenant, name: `S0 ${trigger}`, description: "stage0", category: "ORDERS" as never,
      trigger, version: 1, status: "ACTIVE", configuration: {}, risk_level: "LOW", approval_requirement: "NONE", created_at: ts, updated_at: ts,
    });
    db.createAutomation({
      id: `auto_s0_${suffix}`, tenant_id: tenant, name: `S0 ${trigger}`, description: "stage0", status: "ACTIVE", category: "ORDERS" as never,
      trigger_type: "EVENT", workflow_id: `awf_s0_${suffix}`, workflow_version_id: `awv_s0_${suffix}`, enabled: true, execution_mode: "PRODUCTION",
      configuration: {}, created_by: "usr_s0", updated_by: "usr_s0", created_at: ts, updated_at: ts,
    });
    return `auto_s0_${suffix}`;
  };
  automationFor(victimId, "order.created", "victim");
  const ownOrderAutomation = automationFor(tenantId, "order.created", "own_order");
  automationFor(tenantId, "payment.received", "own_payment");
  const manager = await member(tenantId, "MANAGER");
  const events = (await import("@/app/api/v1/automation/events/route")) as { POST: Handler };
  const savedHost = { a: process.env.N8N_HOST, b: process.env.COMMERCEOS_N8N_BASE_URL };
  delete process.env.N8N_HOST; // no n8n: an execution is recorded as FAILED, nothing is called
  delete process.env.COMMERCEOS_N8N_BASE_URL;

  await runTest("a body naming another workspace's tenant_id is refused; that workspace's automations never run (F32)", async () => {
    const before = db.getAutomationExecutions(victimId).length;
    const res = await post(events.POST, "automation/events", manager.token, {
      type: "order.created", aggregate_type: "order", aggregate_id: "ord_x", tenant_id: victimId, payload: { customer_phone: "01700000000" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.getAutomationExecutions(victimId).length, before, "no execution in the other workspace");
  });

  await runTest("an event fires only this workspace's automations for exactly that event type", async () => {
    const res = await post(events.POST, "automation/events", manager.token, { type: "order.created", aggregate_type: "order", aggregate_id: "ord_y", payload: {} });
    assert.strictEqual(res.status, 200);
    const routed = ((await res.json()) as { data: { routed: Array<{ automationId: string }> } }).data.routed.map((r) => r.automationId);
    assert.deepStrictEqual(routed, [ownOrderAutomation], "not the payment.received automation, not the other workspace's");
  });

  await runTest("the actor comes from the session: a body carrying actor_id is refused", async () => {
    const res = await post(events.POST, "automation/events", manager.token, { type: "order.created", aggregate_type: "order", aggregate_id: "ord_z", actor_id: "someone_else" });
    assert.strictEqual(res.status, 400);
  });

  if (savedHost.a !== undefined) process.env.N8N_HOST = savedHost.a;
  if (savedHost.b !== undefined) process.env.COMMERCEOS_N8N_BASE_URL = savedHost.b;

  const admin = await member(tenantId, "ADMIN");
  const notify = (await import("@/app/api/v1/automation/actions/notifications/send/route")) as { POST: Handler };
  const notifyHeaders = () => ({ "idempotency-key": `idem_s0_${Math.random().toString(36).slice(2, 10)}` });

  await runTest("the notification action never claims DELIVERED: nothing is wired, so it says nothing was sent (F33)", async () => {
    const res = await post(notify.POST, "automation/actions/notifications/send", admin.token, { channel: "WHATSAPP", user_id: admin.id, message: "probe" }, notifyHeaders());
    assert.strictEqual(res.status, 424);
    const text = await res.text();
    assert.ok(text.includes("INTEGRATION_NOT_CONFIGURED") && text.includes("Nothing was sent"), text);
    assert.ok(!text.includes("DELIVERED"));
  });

  await runTest("a recipient phone number in the body is refused; recipients come from this workspace's records", async () => {
    const raw = await post(notify.POST, "automation/actions/notifications/send", admin.token, { channel: "SMS", recipient: "01700000000", message: "x" }, notifyHeaders());
    assert.strictEqual(raw.status, 400);
    const foreignOrder = await post(notify.POST, "automation/actions/notifications/send", admin.token, { channel: "SMS", order_id: "ord_not_here", message: "x" }, notifyHeaders());
    assert.strictEqual(foreignOrder.status, 404);
    const foreignUser = await post(notify.POST, "automation/actions/notifications/send", admin.token, { channel: "SMS", user_id: victim.user.id, message: "x" }, notifyHeaders());
    assert.strictEqual(foreignUser.status, 404, "a staff member of another workspace isn't a recipient here");
  });

  // ------------------------------------------------------------------ security review follow-ups
  console.log(`\n${BOLD}[Review follow-ups] Price-change approvals and the test harness${RESET}`);

  const approve = (await import("@/app/api/v1/operations/actions/[id]/approve/route")) as {
    POST: (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  const decide = (id: string, body: unknown) =>
    approve.POST(
      new Request(`${BASE}/operations/actions/${id}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${admin.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    );

  await runTest("a rejected price change is saved as REJECTED and can't be executed afterwards", async () => {
    const req = priceRequest("SCHEDULED");
    assert.strictEqual((await decide(req.id, { action_type: "PRICE_CHANGE", approved: false, reason: "too low" })).status, 200);
    assert.strictEqual(db.getPriceChangeRequests(tenantId).find((r) => r.id === req.id)?.status, "REJECTED");
    assert.strictEqual((await decide(req.id, { action_type: "PRICE_CHANGE", approved: true })).status, 409);
    assert.strictEqual(db.findVariantById(tenantId, variant.id)?.price, 2500);
  });

  await runTest("the approve route takes a strict body: a string boolean or an unknown action type is refused", async () => {
    const req = priceRequest("SCHEDULED");
    assert.strictEqual((await decide(req.id, { action_type: "PRICE_CHANGE", approved: "false" })).status, 400);
    assert.strictEqual((await decide(req.id, { action_type: "SOMETHING_ELSE", approved: true })).status, 400);
    assert.strictEqual(db.getPriceChangeRequests(tenantId).find((r) => r.id === req.id)?.status, "SCHEDULED", "nothing happened");
  });

  // `fresh`: start like a developer's shell, with the live settings unset, so the runner itself must blank whatever
  // .env.local would refill. Otherwise the child inherits this test process's environment, as a spawned worker does.
  const LIVE_KEYS = ["DATABASE_URL", "DATABASE_URL_POOLED", "QDRANT_URL", "QDRANT_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
    "N8N_HOST", "LLM_BASE_URL", "LLM_FALLBACK_BASE_URL", "TYPESAFE_API_KEY", "DATA_BACKEND"];
  const probeEnv = (extra: Record<string, string>, fresh = true) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", ...extra };
    if (fresh) for (const key of LIVE_KEYS) delete env[key];
    const res = spawnSync(process.execPath, ["tests/ts-runner.cjs", "./tests/fixtures/env-probe.ts"], {
      cwd: path.resolve(__dirname, ".."),
      env,
      encoding: "utf-8",
      timeout: 60_000,
    });
    const line = (res.stdout || "").split("\n").find((l) => l.startsWith("RESULT "));
    assert.ok(line, `probe printed nothing: ${(res.stderr || "").slice(0, 300)}`);
    return JSON.parse(line.slice(7)) as Record<string, boolean>;
  };

  await runTest("a test process sees no live database, vector store, cache, n8n or model", () => {
    const seen = probeEnv({});
    assert.deepStrictEqual(Object.entries(seen).filter(([, set]) => set).map(([k]) => k), []);
  });

  await runTest("TEST_LLM_LIVE=1 brings back only the model, never the databases or n8n", () => {
    const seen = probeEnv({ TEST_LLM_LIVE: "1" });
    for (const key of ["DATABASE_URL", "QDRANT_URL", "UPSTASH_REDIS_REST_URL", "N8N_HOST"]) assert.strictEqual(seen[key], false, key);
  });

  await runTest("a development-mode child of a test process doesn't get the live model or database back", () => {
    const seen = probeEnv({ NODE_ENV: "development" }, false);
    assert.strictEqual(seen.LLM_BASE_URL, false);
    assert.strictEqual(seen.DATABASE_URL, false);
  });

  await runTest("no code in src runs a tool by name outside the agent loop", () => {
    const root = path.resolve(__dirname, "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry.name) && /toolRegistry\.execute\(/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(root);
    assert.deepStrictEqual(offenders, []);
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal stage 0 test error:", err);
  process.exit(1);
});
