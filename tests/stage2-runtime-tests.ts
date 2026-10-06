/**
 * Customer agent Stage 2: resilience (FX-79), output guards (FX-78), the single-agent runtime (FX-77) and agent jobs
 * (FX-76, ADR-112). No real model or network: a scripted provider stands in for the model, and the outbound transport
 * answers Telegram and the "provider" hosts.
 */
import assert from "assert";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { OutboundMessageService } from "@/domains/social/outbound/outbound-message.service";
import { PERMISSIONS } from "@/lib/permissions";
import { setOutboundTransportForTesting, type OutboundResponse } from "@/lib/outbound-http";
import type { RequestContext } from "@/lib/context";
import type { ConnectedChannel, Message, NormalizedIncomingMessage } from "@/types/social";
import type { LLMMessage, LLMProvider, LLMResponse, LLMToolCall, LLMToolDefinition } from "@/domains/ai/providers/llm-provider.interface";
import { OpenAICompatibleProvider } from "@/domains/ai/providers/openai-compatible.provider";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { LLM_BUSY, retryAfterMs, Semaphore } from "@/domains/ai/providers/resilience";
import { principalFor, type CustomerAgentPrincipal } from "@/domains/ai/customer-agent/principal";
import {
  allowedAmounts, capLength, guardOrderClaim, guardPaymentClaim, guardPhoneNumbers, notAMessage, replyScript, sanitizeOutbound,
  stripAmounts, unsupportedAmounts,
} from "@/domains/ai/customer-agent/output";
import { conversationSlots, runCustomerTurn } from "@/domains/ai/customer-agent/runtime";
import { AUTONOMOUS_FLAG, SHADOW_FLAG, agentMode } from "@/domains/ai/customer-agent/jobs";
import { customerMessages } from "@/domains/ai/customer-agent/confirmation";
import { runAgentJobsOnce } from "@/domains/ai/customer-agent/worker";

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

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tool results are free-form JSON

// ---- outbound transport: fake model hosts and Telegram -------------------------------------------------------------
type Handler = (url: URL, body: R) => Promise<Partial<OutboundResponse>> | Partial<OutboundResponse>;
let llmHandler: Handler = () => ({ status: 500, body: "{}" });
const telegramSends: R[] = [];
setOutboundTransportForTesting(async (url, options) => {
  const body = options.body ? JSON.parse(String(options.body)) : {};
  let res: Partial<OutboundResponse>;
  if (url.hostname === "api.telegram.org") {
    if (url.pathname.endsWith("/sendMessage")) telegramSends.push(body);
    res = { status: 200, body: JSON.stringify({ ok: true, result: { message_id: telegramSends.length + 100, date: 1, id: 1, is_bot: true, username: "shop_bot" } }) };
  } else {
    res = await llmHandler(url, body);
  }
  return { status: 200, headers: {}, body: "{}", truncated: false, durationMs: 1, ...res };
});
const wire = (content: string, model = "m") =>
  JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
const providerAt = (host: string, extra: Partial<ConstructorParameters<typeof OpenAICompatibleProvider>[0]> = {}) =>
  new OpenAICompatibleProvider({ baseUrl: `https://${host}/v1`, name: host, models: { TIER_1_FAST: "fast-model", TIER_2_REASONING: "fast-model", TIER_3_EMBEDDING: "" }, ...extra });

// ---- a scripted model ------------------------------------------------------------------------------------------------
type StepOut = { content?: string; tool_calls?: Array<{ name: string; arguments: R }> };
type Step = (messages: LLMMessage[]) => StepOut | Promise<StepOut>;
class ScriptedProvider implements LLMProvider {
  public readonly providerName = "scripted";
  public steps: Step[] = [];
  public calls: LLMMessage[][] = [];
  public lockHeldDuringCall = false;
  public failWith: Error | null = null;
  async chat(messages: LLMMessage[], _tools?: LLMToolDefinition[]): Promise<LLMResponse> {
    if (db.isInUnit()) this.lockHeldDuringCall = true;
    this.calls.push(messages.map((m) => ({ ...m })));
    if (this.failWith) throw this.failWith;
    const step = this.steps.shift();
    if (!step) throw new Error("scripted provider: no step left");
    const out = await step(messages);
    const tool_calls: LLMToolCall[] = (out.tool_calls ?? []).map((t, i) => ({ id: `call_${this.calls.length}_${i}`, name: t.name, arguments: t.arguments }));
    return { content: out.content ?? "", tool_calls, usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, model: "scripted-model", latency_ms: 1 };
  }
  async generate(): Promise<string> {
    return "";
  }
  async structuredOutput<T>(): Promise<{ data: T; usage: LLMResponse["usage"]; latency_ms: number }> {
    throw new Error("not used");
  }
  async embed(): Promise<number[]> {
    throw new Error("not used");
  }
}
const lastTool = (messages: LLMMessage[]): R => {
  const t = [...messages].reverse().find((m) => m.role === "tool");
  return t ? JSON.parse(t.content) : {};
};
const say = (content: string): Step => () => ({ content });
const call = (name: string, args: (m: LLMMessage[]) => R): Step => (m) => ({ tool_calls: [{ name, arguments: args(m) }] });

const ctxFor = (tenant: { id: string; name: string; slug: string }, user: { id: string; email: string; name: string }): RequestContext => ({
  requestId: "req_s2",
  traceId: "tr_s2",
  user: { id: user.id, email: user.email, name: user.name, status: "ACTIVE" },
  tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
  role: "OWNER",
  permissions: Object.values(PERMISSIONS),
  timestamp: new Date().toISOString(),
});

async function main() {
  console.log(`\n${BOLD}CUSTOMER AGENT STAGE 2: RESILIENCE, GUARDS, RUNTIME, JOBS${RESET}\n`);

  // ================================================================ FX-79 resilience
  console.log(`${BOLD}FX-79 provider resilience${RESET}`);

  await runTest("429, 429, then 200 succeeds after two retries", async () => {
    let n = 0;
    llmHandler = () => (++n < 3 ? { status: 429, headers: { "retry-after": "0" } } : { body: wire("ok") });
    const res = await providerAt("llm-a.example.com").chat([{ role: "user", content: "hi" }]);
    assert.strictEqual(res.content, "ok");
    assert.strictEqual(n, 3);
  });

  await runTest("retry-after is honoured", async () => {
    let n = 0;
    llmHandler = () => (++n === 1 ? { status: 429, headers: { "retry-after": "1" } } : { body: wire("ok") });
    const t0 = Date.now();
    await providerAt("llm-b.example.com").chat([{ role: "user", content: "hi" }]);
    assert.ok(Date.now() - t0 >= 950, "waited about a second");
    assert.strictEqual(retryAfterMs("2"), 2000);
    assert.strictEqual(retryAfterMs(new Date(Date.now() + 3000).toUTCString(), Date.now()) !== undefined, true);
    assert.strictEqual(retryAfterMs("soon"), undefined);
  });

  await runTest("400 is retried once; 401 is never retried", async () => {
    let n = 0;
    llmHandler = () => (n++, { status: 400 });
    await assert.rejects(providerAt("llm-c.example.com").chat([{ role: "user", content: "hi" }]));
    assert.strictEqual(n, 2);
    n = 0;
    llmHandler = () => (n++, { status: 401 });
    await assert.rejects(providerAt("llm-c.example.com").chat([{ role: "user", content: "hi" }]));
    assert.strictEqual(n, 1);
  });

  await runTest("5xx gives up at the deadline instead of sleeping past it", async () => {
    llmHandler = () => ({ status: 503, headers: { "retry-after": "5" } });
    const t0 = Date.now();
    await assert.rejects(providerAt("llm-d.example.com").chat([{ role: "user", content: "hi" }], undefined, { deadline_ms: Date.now() + 300 }));
    assert.ok(Date.now() - t0 < 1000, "no 5-second sleep past a 300 ms deadline");
  });

  await runTest("concurrency limit 3: six calls never have more than 3 in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    llmHandler = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 60));
      inFlight--;
      return { body: wire("ok") };
    };
    const p = providerAt("llm-e.example.com", { maxConcurrency: 3 });
    const all = await Promise.all(Array.from({ length: 6 }, () => p.chat([{ role: "user", content: "hi" }])));
    assert.strictEqual(all.length, 6);
    assert.strictEqual(peak, 3);
  });

  await runTest("waiting for a slot past the deadline fails fast with LLM_BUSY", async () => {
    llmHandler = async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { body: wire("ok") };
    };
    const p = providerAt("llm-f.example.com", { maxConcurrency: 1 });
    const first = p.chat([{ role: "user", content: "a" }]);
    await assert.rejects(p.chat([{ role: "user", content: "b" }], undefined, { deadline_ms: Date.now() + 100 }), (e: R) => e.code === LLM_BUSY);
    await first;
    const s = new Semaphore(1);
    const release = await s.acquire(Date.now() + 10);
    await assert.rejects(s.acquire(Date.now() - 1), (e: R) => e.code === LLM_BUSY);
    release();
    assert.strictEqual(s.inUse, 0);
  });

  await runTest("max_tokens defaults to 2048 on every chat call", async () => {
    let seen: R = {};
    llmHandler = (_u, body) => ((seen = body), { body: wire("ok") });
    await providerAt("llm-g.example.com").chat([{ role: "user", content: "hi" }]);
    assert.strictEqual(seen.max_tokens, 2048);
  });

  await runTest("fallback is used only with its own model names; LLM_BUSY doesn't count as a provider failure", async () => {
    const seen: Array<{ host: string; model: string }> = [];
    llmHandler = (url, body) => {
      seen.push({ host: url.hostname, model: body.model });
      return url.hostname === "primary.example.com" ? { status: 401 } : { body: wire("from fallback", body.model) };
    };
    modelRouter.configure({
      LLM_BASE_URL: "https://primary.example.com/v1", LLM_MODEL_FAST: "primary-fast",
      LLM_FALLBACK_BASE_URL: "https://fallback.example.com/v1", LLM_FALLBACK_MODEL_FAST: "fallback-fast",
    } as unknown as NodeJS.ProcessEnv);
    const res = await modelRouter.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "hi" }]);
    assert.strictEqual(res.isFallback, true);
    assert.deepStrictEqual(seen, [{ host: "primary.example.com", model: "primary-fast" }, { host: "fallback.example.com", model: "fallback-fast" }]);

    // Without a fallback model there is no fallback (it used to be sent the primary's model names)
    modelRouter.configure({ LLM_BASE_URL: "https://primary.example.com/v1", LLM_MODEL_FAST: "primary-fast", LLM_FALLBACK_BASE_URL: "https://fallback.example.com/v1" } as unknown as NodeJS.ProcessEnv);
    assert.strictEqual(modelRouter.getStatus().fallback, null);

    const busy = new ScriptedProvider();
    busy.failWith = Object.assign(new Error("busy"), { code: LLM_BUSY });
    modelRouter.setPrimaryProvider(busy);
    modelRouter.setFallbackProvider(null);
    modelRouter.resetCircuitBreakers();
    for (let i = 0; i < 6; i++) await assert.rejects(modelRouter.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "x" }]));
    assert.strictEqual(modelRouter.getCircuitBreakerStatus().failureCount, 0);
  });

  // ================================================================ fixture
  db.clearAllForTesting();
  const stamp = Date.now();
  const owner = await AuthService.registerTenantWithOwner({ workspaceName: "Dhaka Fashion House", name: "Owner", email: `s2-${stamp}@example.com`, password: "Stage2-Test-Pass-2026!", currency: "BDT" });
  db.ensureDefaultSeed(owner.tenant.id);
  const tenantId = owner.tenant.id;
  const ownerCtx = ctxFor(owner.tenant, owner.user);
  await ProductService.createProduct(ownerCtx, {
    name: "Black Cotton T-Shirt", sku: "TS-BLK", base_price: 650, status: "ACTIVE",
    variants: [["M", 20], ["L", 15]].map(([size, stock]) => ({ title: size, sku: `TS-BLK-${size}`, price: 650, initial_stock: stock, attributes: { size } })),
  } as never);

  const fakeToken = `${"7".repeat(9)}:${"A".repeat(35)}`; // matches the token format; nothing real
  const telegram = (await ChannelService.connectChannel(ownerCtx, {
    type: "TELEGRAM", name: `Telegram ${stamp}`, provider_account_id: `tg_${stamp}`, credentials: { bot_token: fakeToken },
  } as never)) as ConnectedChannel;
  const channel = db.findConnectedChannelById(tenantId, telegram.id)!;

  // The merchant's own AI policy must allow autonomous replies (the default is copilot, which means shadow at most)
  const basePolicy = db.getAIPolicy(tenantId);
  db.setAIPolicy({ ...basePolicy, ai_mode: "AI_AUTONOMOUS", is_enabled: true, allowed_channel_types: [...basePolicy.allowed_channel_types, "TELEGRAM"] });
  const scripted = new ScriptedProvider();
  modelRouter.setPrimaryProvider(scripted);
  modelRouter.setFallbackProvider(null);
  modelRouter.resetCircuitBreakers();

  let ext = 0;
  /** A customer message arriving through the real ingress path (identity, conversation, enqueue). */
  const inbound = async (chat: string, text: string, externalMessageId = `m_${stamp}_${++ext}`) => {
    const norm: NormalizedIncomingMessage = {
      channelType: "TELEGRAM", channelId: channel.id, externalEventId: `ev_${externalMessageId}`, externalMessageId,
      externalConversationId: chat, externalSenderId: `user_${chat}`, senderProfile: { displayName: "Rahim" },
      direction: "INBOUND", messageType: "TEXT", text, timestamp: new Date().toISOString(),
    } as NormalizedIncomingMessage;
    await WebhookIngressService.ingestNormalized(channel, [norm], []);
    return db.findConversationByExternalId(tenantId, channel.id, chat)!;
  };
  const flag = (key: string, on: boolean) =>
    db.savePlatformFeatureFlag({
      id: `ff_${key}`, key, description: key, is_enabled_globally: false, percentage_rollout: 100, scope: "TENANT",
      tenant_allowlist: on ? [tenantId] : [], rules: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as never);
  const makeDue = (conversationId: string) => {
    const job = db.findAgentJob(tenantId, conversationId)!;
    db.saveAgentJob({ ...job, not_before: new Date(Date.now() - 1).toISOString() });
  };
  const outbound = (conversationId: string) =>
    db.getMessages(tenantId, conversationId, { limit: 50 }).messages.filter((m: Message) => m.direction === "OUTBOUND" && m.message_type !== "INTERNAL_NOTE");

  // ================================================================ FX-78 output guards
  console.log(`\n${BOLD}FX-78 output guards${RESET}`);

  await runTest("not-a-message: JSON and tool-call text are never sent", () => {
    assert.strictEqual(notAMessage('{"name":"search_products"}'), true);
    assert.strictEqual(notAMessage("<tool_call>search</tool_call>"), true);
    assert.strictEqual(notAMessage("   "), true);
    assert.strictEqual(notAMessage("Ji, L size ache. Dam 650 taka."), false);
  });

  await runTest("sanitize: links, Markdown and HTML removed; non-breaking hyphens in order numbers fixed", () => {
    const out = sanitizeOutbound("**Dam** [ekhane](https://evil.example) <b>dekhun</b> https://x.example/pay ORD‑2026‑000001");
    assert.ok(!/https?:|\*\*|<b>/.test(out), out);
    assert.ok(out.includes("ORD-2026-000001"));
  });

  await runTest("phone numbers: only the shop's own or ones this customer typed survive", async () => {
    const convo = await inbound("guard_chat", "amar number 01711000001");
    const out = guardPhoneNumbers(tenantId, convo.id, "Call 01711000001 or bKash 01999888777");
    assert.strictEqual(out.removed, 1);
    assert.ok(out.text.includes("01711000001") && out.text.includes("[number removed]"));
  });

  await runTest("order claim without a placed order number is replaced", () => {
    assert.strictEqual(guardOrderClaim("Your order has been placed!", [], "latin").blocked, true);
    assert.strictEqual(guardOrderClaim("Your order ORD-2026-000001 has been placed!", ["ORD-2026-000001"], "latin").blocked, false);
    assert.strictEqual(guardOrderClaim("Your order ORD-2026-000009 has been placed!", ["ORD-2026-000001"], "latin").blocked, true);
    assert.ok(guardOrderClaim("অর্ডারটি নিশ্চিত হয়েছে", [], "bangla").text.includes("অর্ডারটি এখনও"));
  });

  await runTest("amounts must come from this turn's tool results", () => {
    const allowed = allowedAmounts([{ price_bdt: 650, delivery_charge: 60 }, "grand total ৳710"]);
    assert.deepStrictEqual(unsupportedAmounts("Dam 650 taka, delivery ৳60, total 710 tk", allowed), []);
    assert.deepStrictEqual(unsupportedAmounts("Discount diye 550 taka", allowed), [550]);
    assert.deepStrictEqual(unsupportedAmounts("৬৫০ টাকা", allowed), []);
    assert.ok(!stripAmounts("Dam 550 taka hobe", [550]).includes("550"));
  });

  await runTest("payment claims are blocked; script and length are enforced", () => {
    assert.strictEqual(guardPaymentClaim("Payment received, thanks!", "latin").blocked, true);
    assert.strictEqual(guardPaymentClaim("পেমেন্ট পেয়েছি", "bangla").blocked, true);
    assert.strictEqual(replyScript("আমি একটা টি-শার্ট চাই"), "bangla");
    assert.strictEqual(replyScript("ami ekta tshirt chai"), "latin");
    assert.ok(capLength("Ek. ".repeat(400)).length <= 1000);
  });

  // ================================================================ FX-77 runtime
  console.log(`\n${BOLD}FX-77 single-agent runtime${RESET}`);
  flag(AUTONOMOUS_FLAG, false);
  flag(SHADOW_FLAG, false);
  let pr: CustomerAgentPrincipal;

  await runTest("history is oldest-first and the current message appears once, last", async () => {
    const convo = await inbound("rt_chat", "Assalamu alaikum");
    await inbound("rt_chat", "Black t-shirt ache?");
    pr = principalFor(tenantId, convo.id)!;
    scripted.calls = [];
    scripted.steps = [say("Ji ache. Kon size lagbe?")];
    const turn = await runCustomerTurn(pr);
    assert.strictEqual(turn.status, "COMPLETED");
    const msgs = scripted.calls[0];
    assert.strictEqual(msgs[0].role, "system");
    assert.deepStrictEqual(msgs[msgs.length - 1], { role: "user", content: "Black t-shirt ache?" });
    assert.strictEqual(msgs.filter((m) => m.content === "Black t-shirt ache?").length, 1);
    assert.ok(msgs.findIndex((m) => m.content === "Assalamu alaikum") < msgs.length - 2);
    assert.ok(msgs[msgs.length - 2].role === "system" && msgs[msgs.length - 2].content.includes("<session_state"));
    assert.strictEqual(scripted.lockHeldDuringCall, false, "the model is never called while holding the store lock");
  });

  await runTest("slots: name, phone and district the customer stated are extracted", async () => {
    await inbound("rt_chat", "amar naam Rahim Uddin, 01711000001, House 12 Road 5 Mirpur 10, Dhaka");
    const slots = conversationSlots(pr).join("\n");
    assert.ok(slots.includes("phone: 01711000001"), slots);
    assert.ok(/name: Rahim Uddin/.test(slots), slots);
    assert.ok(slots.includes("district: Dhaka"), slots);
  });

  let quoteId = "";
  let orderNumber = "";
  await runTest("scripted flow: search → quote → confirmation required → reply with the server's total", async () => {
    await inbound("rt_chat", "L size ta nibo, Dhaka te pathan");
    scripted.steps = [
      call("search_products", () => ({ query: "black t-shirt" })),
      call("quote_order", (m) => ({ items: [{ variant_id: (lastTool(m).results[0].variants as R[]).find((v) => v.size === "L")!.variant_id, quantity: 1 }], district: "Dhaka" })),
      call("place_order", (m) => {
        quoteId = lastTool(m).quote_id;
        return { quote_id: quoteId, customer_name: "Rahim Uddin", phone: "01711000001", address_line: "House 12 Road 5 Mirpur 10", payment_method: "COD" };
      }),
      (m) => {
        const q = db.findQuote(tenantId, pr.conversationId, quoteId)!;
        assert.strictEqual(lastTool(m).status, "CONFIRMATION_REQUIRED");
        return { content: `Total ${q.grand_total} taka (COD). Confirm korben?` };
      },
    ];
    const turn = await runCustomerTurn(pr);
    assert.strictEqual(turn.status, "COMPLETED", JSON.stringify(turn));
    assert.deepStrictEqual(turn.toolCalls.map((t) => t.name), ["search_products", "quote_order", "place_order"]);
    assert.ok(!turn.guards.includes("amount_stripped"), turn.guards.join(","));
    const q = db.getConversationQuotes(tenantId, pr.conversationId).find((x) => x.id === quoteId)!;
    assert.strictEqual(q.status, "QUOTED");
    assert.strictEqual(q.shown_message_id, undefined, "the runtime alone never marks a quote as seen");
    // What the worker does once the reply is delivered
    db.updateQuote(tenantId, q.id, { shown_message_id: "msg_delivered", customer_msg_count_at_quote: customerMessages(tenantId, pr.conversationId).length });
  });

  await runTest("after the customer's yes the order is placed and the claim names the real order number", async () => {
    await inbound("rt_chat", "yes");
    scripted.steps = [
      call("place_order", () => ({ quote_id: quoteId, customer_name: "Rahim Uddin", phone: "01711000001", address_line: "House 12 Road 5 Mirpur 10", payment_method: "COD" })),
      (m) => {
        orderNumber = lastTool(m).order_number;
        return { content: `Apnar order ${orderNumber} placed hoyeche. Dhonnobad!` };
      },
    ];
    const turn = await runCustomerTurn(pr);
    assert.ok(/^ORD-/.test(orderNumber), orderNumber);
    assert.ok(turn.reply.includes(orderNumber));
    assert.ok(!turn.guards.includes("order_claim_blocked"));
    const order = db.getAllOrders(tenantId).find((o) => o.order_number === orderNumber)!;
    assert.strictEqual(order.source_conversation_id, pr.conversationId);
  });

  await runTest("an invented order claim is replaced; invented amounts are retried then stripped", async () => {
    await inbound("rt_chat", "arekta order korun");
    scripted.steps = [say("Your order has been placed!")];
    let turn = await runCustomerTurn(pr);
    assert.ok(turn.guards.includes("order_claim_blocked"));
    assert.ok(!/has been placed/.test(turn.reply));

    await inbound("rt_chat", "dam koto?");
    scripted.steps = [say("Dam 499 taka."), say("Dam 499 taka, special.")];
    turn = await runCustomerTurn(pr);
    assert.ok(turn.guards.includes("amount_retry") && turn.guards.includes("amount_stripped"), turn.guards.join(","));
    assert.ok(!turn.reply.includes("499"));
  });

  await runTest("tool-call text is retried, then the turn hands off with the standard reply", async () => {
    await inbound("rt_chat", "hello?");
    scripted.steps = [say('{"name":"search_products"}'), say('{"name":"search_products"}')];
    const turn = await runCustomerTurn(pr);
    assert.strictEqual(turn.status, "FAILED");
    assert.ok(turn.handoff && turn.reply.length > 0);
    const run = db.getAgentRuns(tenantId, { conversation_id: pr.conversationId }).find((r) => r.id === turn.runId)!;
    assert.strictEqual(run.prompt_version, "customer-agent.system.v2.1-cod");
  });

  await runTest("tool-call arguments are stored redacted", () => {
    const rows = (db.data.agent_tool_calls as R[]).filter((c) => c.conversation_id === pr.conversationId && c.tool_name === "place_order");
    assert.ok(rows.length > 0);
    for (const r of rows) assert.ok(Object.values(r.input_arguments).every((v) => v === "[redacted]"), JSON.stringify(r.input_arguments));
  });

  // ================================================================ FX-76 jobs and worker
  console.log(`\n${BOLD}FX-76 agent jobs and worker${RESET}`);

  await runTest("no flag (or a flag that is off): no job is queued", async () => {
    assert.strictEqual(agentMode(tenantId), "OFF");
    const convo = await inbound("job_off", "hi");
    assert.strictEqual(db.findAgentJob(tenantId, convo.id), undefined);
    db.data.platform_feature_flags = db.data.platform_feature_flags.filter((f: R) => f.key !== AUTONOMOUS_FLAG && f.key !== SHADOW_FLAG);
    assert.strictEqual(agentMode(tenantId), "OFF", "a missing flag means OFF for the agent");
    flag(AUTONOMOUS_FLAG, false);
    flag(SHADOW_FLAG, false);
  });

  await runTest("autonomous: one job per chat, a duplicate webhook adds nothing, debounce holds the turn", async () => {
    flag(AUTONOMOUS_FLAG, true);
    assert.strictEqual(agentMode(tenantId), "AUTONOMOUS");
    const convo = await inbound("job_auto", "Black t-shirt ache?", "dup_1");
    await inbound("job_auto", "Black t-shirt ache?", "dup_1");
    const msgs = db.getMessages(tenantId, convo.id, { limit: 10 }).messages;
    assert.strictEqual(msgs.length, 1);
    const job = db.findAgentJob(tenantId, convo.id)!;
    assert.strictEqual(job.status, "PENDING");
    assert.ok(job.not_before > new Date().toISOString());
    const stats = await runAgentJobsOnce();
    assert.strictEqual(stats.claimed, 0, "not before the debounce");
  });

  await runTest("autonomous: the reply is sent through the outbound path as the bot; the chat stays with the bot", async () => {
    const convo = db.findConversationByExternalId(tenantId, channel.id, "job_auto")!;
    makeDue(convo.id);
    scripted.lockHeldDuringCall = false;
    scripted.steps = [say("Ji, black t-shirt ache. Kon size?")];
    const sendsBefore = telegramSends.length;
    const stats = await runAgentJobsOnce();
    assert.strictEqual(stats.claimed, 1);
    assert.strictEqual(scripted.lockHeldDuringCall, false);
    assert.strictEqual(telegramSends.length, sendsBefore + 1);
    const out = outbound(convo.id);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].sender_type, "BOT");
    assert.strictEqual(out[0].status, "SENT");
    const after = db.findConversationById(tenantId, convo.id)!;
    assert.strictEqual(after.automation_paused, false);
    assert.strictEqual(after.mode, "AI");
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.status, "DONE");
  });

  await runTest("a message during a running turn asks for one more turn", async () => {
    const convo = db.findConversationByExternalId(tenantId, channel.id, "job_auto")!;
    const job = db.findAgentJob(tenantId, convo.id)!;
    db.saveAgentJob({ ...job, status: "RUNNING", claimed_at: new Date().toISOString() });
    await inbound("job_auto", "L size");
    const after = db.findAgentJob(tenantId, convo.id)!;
    assert.strictEqual(after.status, "RUNNING");
    assert.strictEqual(after.rerun, true);
    db.saveAgentJob({ ...after, status: "DONE", rerun: false });
  });

  await runTest("a staff reply takes the chat over: later messages queue nothing", async () => {
    const convo = await inbound("job_staff", "hello");
    makeDue(convo.id);
    await OutboundMessageService.sendMessage(ownerCtx, convo.id, { text: "Ami Owner, bolun" });
    const paused = db.findConversationById(tenantId, convo.id)!;
    assert.strictEqual(paused.automation_paused, true);
    const stats = await runAgentJobsOnce();
    assert.strictEqual(stats.done, 0);
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.status, "CANCELLED");
    await inbound("job_staff", "ok");
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.status, "CANCELLED");
  });

  await runTest("a CHANNEL kill switch blocks the send: job BLOCKED, nothing reaches Telegram", async () => {
    const convo = await inbound("job_killed", "hi");
    makeDue(convo.id);
    db.savePlatformKillSwitch({ id: `ks_${stamp}`, scope: "CHANNEL", target_id: channel.id, is_active: true, reason: "test", activated_by_user_id: "op", updated_at: new Date().toISOString() } as never);
    scripted.steps = [say("Hello!")];
    const sendsBefore = telegramSends.length;
    await runAgentJobsOnce();
    assert.strictEqual(telegramSends.length, sendsBefore);
    const job = db.findAgentJob(tenantId, convo.id)!;
    assert.strictEqual(job.status, "BLOCKED");
    assert.strictEqual(job.outcome, "KILL_SWITCH");
    assert.strictEqual(scripted.steps.length, 1, "no model call for a reply that can't be sent");
    scripted.steps = [];
    assert.strictEqual(outbound(convo.id).length, 0);
    db.savePlatformKillSwitch({ ...db.findPlatformKillSwitch(`ks_${stamp}`)!, is_active: false });
  });

  await runTest("provider down: the customer gets the standard reply and a person takes over", async () => {
    const convo = await inbound("job_down", "hi");
    makeDue(convo.id);
    scripted.failWith = Object.assign(new Error("down"), { code: "LLM_PROVIDER_ERROR" });
    await runAgentJobsOnce();
    scripted.failWith = null;
    const after = db.findConversationById(tenantId, convo.id)!;
    assert.strictEqual(after.automation_paused, true, "handed off");
    assert.strictEqual(outbound(convo.id).length, 1, JSON.stringify(outbound(convo.id).map((m) => [m.sender_type, m.status, m.text])));
  });

  await runTest("run limit: 20 turns in 10 minutes stops the agent and hands off", async () => {
    const convo = await inbound("job_loop", "hi");
    const now = new Date().toISOString();
    for (let i = 0; i < 20; i++) {
      db.createAgentRun({
        id: `run_loop_${i}`, tenant_id: tenantId, conversation_id: convo.id, agent_type: "CUSTOMER_AGENT", status: "COMPLETED", current_step: "RESPOND",
        model: "x", prompt_version: "x", started_at: now, latency_ms: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, estimated_cost_bdt: 0,
        tool_calls_count: 0, created_at: now,
      } as never);
    }
    makeDue(convo.id);
    await runAgentJobsOnce();
    const job = db.findAgentJob(tenantId, convo.id)!;
    assert.strictEqual(job.status, "BLOCKED");
    assert.strictEqual(job.outcome, "RUN_LIMIT");
    assert.strictEqual(db.findConversationById(tenantId, convo.id)!.automation_paused, true);
  });

  await runTest("shadow: the draft is stored, nothing is sent, and no order or handoff happens", async () => {
    flag(AUTONOMOUS_FLAG, false);
    flag(SHADOW_FLAG, true);
    assert.strictEqual(agentMode(tenantId), "SHADOW");
    const convo = await inbound("job_shadow", "manush er sathe kotha bolbo");
    makeDue(convo.id);
    scripted.steps = [
      call("handoff_to_human", () => ({ reason: "customer_request", summary: "wants a person" })),
      (m) => {
        assert.strictEqual(lastTool(m).error, "SHADOW_MODE");
        return { content: "Ami apnake amader team er sathe jog kore dicchi." };
      },
    ];
    const sendsBefore = telegramSends.length;
    await runAgentJobsOnce();
    assert.strictEqual(telegramSends.length, sendsBefore);
    assert.strictEqual(outbound(convo.id).length, 0);
    const after = db.findConversationById(tenantId, convo.id)!;
    assert.strictEqual(after.automation_paused, false, "no real handoff in shadow mode");
    const draft = after.metadata.agent_shadow_reply as R;
    assert.ok(draft && draft.text.includes("team"), JSON.stringify(after.metadata));
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.status, "DONE");
  });

  // ================================================================ security review fixes (ADR-112)
  console.log(`\n${BOLD}Security review fixes${RESET}`);
  const setMode = (autonomous: boolean, shadow: boolean) => {
    flag(AUTONOMOUS_FLAG, autonomous);
    flag(SHADOW_FLAG, shadow);
  };
  const conv = (chat: string) => db.findConversationByExternalId(tenantId, channel.id, chat)!;

  await runTest("internal notes and failed sends never reach the model or the slots", async () => {
    setMode(true, false);
    const convo = await inbound("rf_notes", "hi");
    const t = new Date().toISOString();
    db.createMessage({ id: `msg_note_${stamp}`, tenant_id: tenantId, conversation_id: convo.id, direction: "OUTBOUND", sender_type: "AGENT", message_type: "INTERNAL_NOTE", text: "STAFF ONLY: suspected fraud, number 01888777666", status: "PROCESSED", retry_count: 0, metadata: {}, created_at: t, updated_at: t } as Message);
    db.createMessage({ id: `msg_failed_${stamp}`, tenant_id: tenantId, conversation_id: convo.id, direction: "OUTBOUND", sender_type: "BOT", message_type: "TEXT", text: "NEVER DELIVERED reply", status: "FAILED", retry_count: 0, metadata: {}, created_at: t, updated_at: t } as Message);
    await inbound("rf_notes", "dam koto?");
    scripted.calls = [];
    scripted.steps = [say("Kon product er dam?")];
    await runCustomerTurn(principalFor(tenantId, convo.id)!);
    const seen = JSON.stringify(scripted.calls);
    assert.ok(!seen.includes("STAFF ONLY") && !seen.includes("NEVER DELIVERED"), "notes and failed sends are not in the prompt");
    assert.ok(!conversationSlots(principalFor(tenantId, convo.id)!).join(" ").includes("01888777666"));
    db.saveAgentJob({ ...db.findAgentJob(tenantId, convo.id)!, status: "DONE" });
  });

  await runTest("a handoff stays a handoff: the bot's 'team will reply' message doesn't reopen the chat", async () => {
    setMode(true, false);
    const convo = await inbound("rf_handoff", "taka kete geche kintu order ashe nai");
    makeDue(convo.id);
    scripted.steps = [call("handoff_to_human", () => ({ reason: "payment_problem", summary: "charged, no order" })), say("Amader team er ekjon ekhane reply dibe.")];
    await runAgentJobsOnce();
    const after = conv("rf_handoff");
    assert.strictEqual(outbound(convo.id).length, 1, "the acknowledgement was sent");
    assert.strictEqual(after.automation_paused, true);
    assert.strictEqual(after.mode, "HUMAN");
    assert.strictEqual(after.status, "WAITING_AGENT");
  });

  await runTest("a failed turn's apology doesn't reopen the chat either", async () => {
    const convo = await inbound("rf_fail", "hello");
    makeDue(convo.id);
    scripted.failWith = Object.assign(new Error("down"), { code: "LLM_PROVIDER_ERROR" });
    await runAgentJobsOnce();
    scripted.failWith = null;
    const after = conv("rf_fail");
    assert.strictEqual(outbound(convo.id).length, 1);
    assert.strictEqual(after.mode, "HUMAN");
    assert.strictEqual(after.status, "WAITING_AGENT");
  });

  await runTest("staff reply during the turn: the bot's reply is not sent", async () => {
    const convo = await inbound("rf_staff", "hello");
    makeDue(convo.id);
    scripted.steps = [
      () => {
        void OutboundMessageService.sendMessage(ownerCtx, convo.id, { text: "Ami Owner, bolun" }).catch(() => undefined);
        return { content: "Ji bolun, ki dorkar?" };
      },
    ];
    await runAgentJobsOnce();
    await new Promise((r) => setTimeout(r, 50));
    const out = outbound(convo.id);
    assert.ok(out.length === 1 && out.every((m) => m.sender_type !== "BOT"), JSON.stringify(out.map((m) => m.sender_type)));
    const job = db.findAgentJob(tenantId, convo.id)!;
    assert.strictEqual(job.status, "CANCELLED");
    assert.strictEqual(job.outcome, "STAFF_REPLIED");
    assert.strictEqual(conv("rf_staff").mode, "HUMAN");
  });

  await runTest("website chat (can't receive replies yet) queues no turn", async () => {
    const web = (await ChannelService.connectChannel(ownerCtx, { type: "WEBSITE_CHAT", name: `Web ${stamp}`, provider_account_id: `web_${stamp}`, credentials: { pageId: `web_${stamp}`, accessToken: "placeholder" } } as never)) as ConnectedChannel;
    const webChannel = db.findConnectedChannelById(tenantId, web.id)!;
    await WebhookIngressService.ingestNormalized(webChannel, [{
      channelType: "WEBSITE_CHAT", channelId: web.id, externalEventId: `ev_web_${stamp}`, externalMessageId: `web_m_${stamp}`, externalConversationId: "visitor_1",
      externalSenderId: "visitor_1", senderProfile: {}, direction: "INBOUND", messageType: "TEXT", text: "hi", timestamp: new Date().toISOString(),
    } as NormalizedIncomingMessage], []);
    const c = db.findConversationByExternalId(tenantId, web.id, "visitor_1")!;
    assert.ok(c);
    assert.strictEqual(db.findAgentJob(tenantId, c.id), undefined);
  });

  await runTest("the workspace's AI policy wins over the platform flag; the daily budget stops turns", async () => {
    setMode(true, false);
    const policy = db.getAIPolicy(tenantId);
    db.setAIPolicy({ ...policy, ai_mode: "DISABLED" });
    assert.strictEqual(agentMode(tenantId), "OFF");
    const off = await inbound("rf_policy_off", "hi");
    assert.strictEqual(db.findAgentJob(tenantId, off.id), undefined);
    db.setAIPolicy({ ...policy, ai_mode: "AI_COPILOT" });
    assert.strictEqual(agentMode(tenantId), "SHADOW", "copilot means drafts only");
    db.setAIPolicy({ ...policy, ai_mode: "AI_AUTONOMOUS", daily_cost_budget_usd: 0 });
    const convo = await inbound("rf_budget", "hi");
    makeDue(convo.id);
    const callsBefore = scripted.calls.length;
    await runAgentJobsOnce();
    assert.strictEqual(scripted.calls.length, callsBefore, "no model call over budget");
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.outcome, "BUDGET");
    db.setAIPolicy({ ...policy, ai_mode: "AI_AUTONOMOUS" });
  });

  await runTest("shadow mode honours the kill switch too: no model call", async () => {
    setMode(false, true);
    const convo = await inbound("rf_shadow_killed", "hi");
    makeDue(convo.id);
    db.savePlatformKillSwitch({ id: `ks_t_${stamp}`, scope: "TENANT", target_id: tenantId, is_active: true, reason: "test", activated_by_user_id: "op", updated_at: new Date().toISOString() } as never);
    const callsBefore = scripted.calls.length;
    await runAgentJobsOnce();
    db.savePlatformKillSwitch({ ...db.findPlatformKillSwitch(`ks_t_${stamp}`)!, is_active: false });
    assert.strictEqual(scripted.calls.length, callsBefore);
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.outcome, "KILL_SWITCH");
  });

  await runTest("a quote the customer never received can't be confirmed; a delivered summary then a yes places it", async () => {
    setMode(false, true);
    const convo = await inbound("rf_quote", "black t-shirt M size Dhaka, Rahim Uddin 01711000001 House 12 Road 5 Mirpur 10");
    makeDue(convo.id);
    let qid = "";
    scripted.steps = [
      call("search_products", () => ({ query: "black t-shirt" })),
      call("quote_order", (m) => ({ items: [{ variant_id: (lastTool(m).results[0].variants as R[]).find((v) => v.size === "M")!.variant_id, quantity: 1 }], district: "Dhaka" })),
      (m) => ((qid = lastTool(m).quote_id), { content: "Total dekhacchi, confirm korben?" }),
    ];
    await runAgentJobsOnce(); // shadow: draft only
    assert.ok(qid, "a quote was made");
    assert.strictEqual(db.findQuote(tenantId, convo.id, qid)!.shown_message_id, undefined, "a shadow quote was never delivered");

    setMode(true, false);
    await inbound("rf_quote", "ok");
    makeDue(convo.id);
    const place = () => ({ quote_id: qid, customer_name: "Rahim Uddin", phone: "01711000001", address_line: "House 12 Road 5 Mirpur 10", payment_method: "COD" });
    let first: R = {};
    scripted.steps = [call("place_order", place), (m) => ((first = lastTool(m)), { content: `Total ${db.findQuote(tenantId, convo.id, qid)!.grand_total} taka, COD. Confirm korben?` })];
    await runAgentJobsOnce();
    assert.strictEqual(first.status, "CONFIRMATION_REQUIRED", "'ok' to an undelivered quote doesn't place it");
    assert.ok(db.findQuote(tenantId, convo.id, qid)!.shown_message_id, "the delivered summary marks the quote as seen");

    await inbound("rf_quote", "yes");
    makeDue(convo.id);
    let second: R = {};
    scripted.steps = [call("place_order", place), (m) => ((second = lastTool(m)), { content: `Order ${lastTool(m).order_number} placed hoyeche.` })];
    await runAgentJobsOnce();
    assert.strictEqual(second.status, "PLACED", JSON.stringify(second));
  });

  await runTest("only a delivered reply that still shows the total makes a quote confirmable", async () => {
    setMode(true, false);
    const convo = await inbound("rf_guarded", "black t-shirt L size Dhaka, Rahim Uddin 01711000001 House 12 Road 5 Mirpur 10");
    makeDue(convo.id);
    let qid = "";
    scripted.steps = [
      call("search_products", () => ({ query: "black t-shirt" })),
      call("quote_order", (m) => ({ items: [{ variant_id: (lastTool(m).results[0].variants as R[]).find((v) => v.size === "L")!.variant_id, quantity: 1 }], district: "Dhaka" })),
      (m) => ((qid = lastTool(m).quote_id), { content: "Your order has been placed!" }), // replaced by the order-claim guard
    ];
    await runAgentJobsOnce();
    assert.strictEqual(db.findQuote(tenantId, convo.id, qid)!.shown_message_id, undefined, "the replaced reply showed no total");
    await inbound("rf_guarded", "ok");
    makeDue(convo.id);
    let r: R = {};
    scripted.steps = [
      call("place_order", () => ({ quote_id: qid, customer_name: "Rahim Uddin", phone: "01711000001", address_line: "House 12 Road 5 Mirpur 10", payment_method: "COD" })),
      (m) => ((r = lastTool(m)), { content: "Confirm korben?" }),
    ];
    await runAgentJobsOnce();
    assert.strictEqual(r.status, "CONFIRMATION_REQUIRED");
  });

  await runTest("a chat paused during the turn (no staff reply) gets no bot reply", async () => {
    setMode(true, false);
    const convo = await inbound("rf_paused", "hello");
    makeDue(convo.id);
    scripted.steps = [
      () => {
        db.updateConversation(tenantId, convo.id, { automation_paused: true, mode: "HUMAN" });
        return { content: "Ji bolun." };
      },
    ];
    await runAgentJobsOnce();
    assert.strictEqual(outbound(convo.id).length, 0);
    assert.strictEqual(db.findAgentJob(tenantId, convo.id)!.outcome, "STAFF_REPLIED");
  });

  await runTest("a channel the workspace's AI policy doesn't allow gets no turn", async () => {
    setMode(true, false);
    const policy = db.getAIPolicy(tenantId);
    db.setAIPolicy({ ...policy, allowed_channel_types: policy.allowed_channel_types.filter((c) => c !== "TELEGRAM") });
    const convo = await inbound("rf_channel", "hi");
    assert.strictEqual(db.findAgentJob(tenantId, convo.id), undefined);
    db.setAIPolicy(policy);
  });

  await runTest("a workspace limit deferral doesn't use up the retry", async () => {
    const convo = await inbound("rf_defer", "hi");
    const job = db.findAgentJob(tenantId, convo.id)!;
    db.saveAgentJob({ ...job, attempts: 1, status: "PENDING", not_before: new Date(Date.now() - 1).toISOString() });
    const now = new Date().toISOString();
    for (let i = 0; i < 300; i++) {
      db.createAgentRun({ id: `run_cap_${i}`, tenant_id: tenantId, conversation_id: `cnv_cap_${i}`, agent_type: "CUSTOMER_AGENT", status: "COMPLETED", current_step: "RESPOND", model: "x", prompt_version: "x", started_at: now, latency_ms: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, estimated_cost_bdt: 0, tool_calls_count: 0, created_at: now } as never);
    }
    await runAgentJobsOnce();
    const after = db.findAgentJob(tenantId, convo.id)!;
    assert.strictEqual(after.status, "PENDING");
    assert.strictEqual(after.outcome, "TENANT_RATE_LIMIT");
    assert.strictEqual(after.attempts, 0);
    db.data.agent_runs = db.data.agent_runs.filter((r: R) => !String(r.id).startsWith("run_cap_"));
    db.saveAgentJob({ ...after, status: "DONE" });
  });

  await runTest("fair scheduling: one busy workspace doesn't hold up another", async () => {
    const other = await AuthService.registerTenantWithOwner({ workspaceName: "Other Shop", name: "Other Owner", email: `s2o-${stamp}@example.com`, password: "Stage2-Test-Pass-2026!", currency: "BDT" });
    const old = new Date(Date.now() - 60_000).toISOString();
    const job = (tenant: string, n: number) => ({
      id: `job_fair_${tenant}_${n}`, tenant_id: tenant, conversation_id: `cnv_fair_${tenant}_${n}`, status: "PENDING" as const, not_before: old,
      last_message_id: "m", attempts: 0, rerun: false, created_at: old, updated_at: old,
    });
    for (let i = 0; i < 250; i++) db.saveAgentJob(job(tenantId, i)); // a backlog bigger than one scan
    db.saveAgentJob({ ...job(other.tenant.id, 0), not_before: new Date(Date.now() - 1000).toISOString() });
    const stats = await runAgentJobsOnce(2);
    assert.strictEqual(stats.claimed, 2);
    assert.notStrictEqual(db.findAgentJob(other.tenant.id, `cnv_fair_${other.tenant.id}_0`)!.status, "PENDING", "the other workspace ran in the first pass");
  });

  setOutboundTransportForTesting(null);
  console.log(`\n${BOLD}Stage 2: ${passed} passed, ${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
