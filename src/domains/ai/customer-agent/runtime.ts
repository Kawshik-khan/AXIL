/**
 * The customer agent's turn (AI fix plan FX-77; audit F07, F08, F15, F18, F19). One agent, nine tools, no router:
 *
 * - Context in a fixed order: the system prompt (a versioned file), the last 10 messages oldest first (each capped),
 *   then the server's <store_context> and <session_state>, then the current message once (capped). No LLM summary, no
 *   router classifier, no third-party intent service on this path.
 * - <session_state> is computed by the server: reply script, linked customer, own recent orders, the open quote, and
 *   facts the customer stated anywhere in the chat (deterministic slots), so they survive the 10-message window.
 * - Loop: at most 6 model calls and 8 tool calls, duplicate calls refused, one 25-second budget for the whole turn.
 * - Every reply goes through the output pipeline (output.ts) before the caller sends it.
 * - Every run is recorded (agent_runs, agent_tool_calls, ai_usage) with the prompt version, tokens and cost.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { findDistrict } from "@/lib/bd-geography";
import { logger } from "@/lib/logger";
import { SEARCH_SYNONYMS, COLOUR_WORDS, searchTokens } from "@/domains/catalog/search-synonyms";
import type { LLMMessage } from "@/domains/ai/providers/llm-provider.interface";
import type { Message } from "@/types/social";
import { visibleOrders, type CustomerAgentPrincipal } from "./principal";
import { CUSTOMER_TOOLS, runCustomerTool, type ToolResult } from "./tools";
import {
  PROMISES_HUMAN, allowedAmounts, capLength, guardOrderClaim, guardPaymentClaim, guardPhoneNumbers, notAMessage, replyScript,
  sanitizeOutbound, stripAmounts, unsupportedAmounts,
} from "./output";

export const PROMPT_FILE = "customer-agent.system.v2.1-cod.md";
export const PROMPT_VERSION = PROMPT_FILE.replace(/\.md$/, "");
const MAX_MODEL_CALLS = 6;
const MAX_TOOL_CALLS = 8;
const TURN_BUDGET_MS = 25_000;
const HISTORY_MESSAGES = 10;

/**
 * What the customer and the agent actually said in the chat. Internal notes are staff-only (the model would take them
 * for its own earlier replies and repeat them), and a reply that failed to send was never seen (ADR-112).
 */
export function chatMessages(tenantId: string, conversationId: string, limit: number): Message[] {
  return db
    .getMessages(tenantId, conversationId, { limit: limit * 3 })
    .messages.filter((m) => m.message_type !== "INTERNAL_NOTE" && !m.metadata?.is_internal_only && !(m.direction === "OUTBOUND" && m.status === "FAILED"))
    .slice(-limit);
}

let promptCache: string | null = null;
function systemPrompt(): string {
  if (promptCache === null) {
    promptCache = fs.readFileSync(path.join(process.cwd(), "src", "domains", "ai", "customer-agent", "prompts", PROMPT_FILE), "utf8");
  }
  return promptCache;
}

export interface CustomerTurn {
  runId: string;
  status: "COMPLETED" | "ESCALATED" | "FAILED" | "NOTHING_TO_ANSWER";
  /** The reply to send, already through the output pipeline; empty when there is nothing to send. */
  reply: string;
  handoff: boolean;
  toolCalls: Array<{ name: string; ok: boolean; refused?: string }>;
  guards: string[];
  /** The customer message this turn answered (the idempotency key for its reply). */
  answeredMessageId?: string;
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} …[message truncated: ${text.length - max} more characters]` : text);

/**
 * Facts the customer stated anywhere in this chat, extracted deterministically. This replaces the LLM summarizer: no
 * extra model call, no transcript sent to a provider, nothing the model wrote promoted into the system role. The values
 * are customer-stated, labelled as such and never used for authorization.
 */
export function conversationSlots(pr: CustomerAgentPrincipal): string[] {
  const msgs = chatMessages(pr.tenantId, pr.conversationId, 200);
  const customer = msgs.filter((m) => m.sender_type === "CUSTOMER").map((m) => m.text);
  const agent = msgs.filter((m) => m.sender_type !== "CUSTOMER").map((m) => m.text);
  const lastMatch = (texts: string[], re: RegExp) => {
    let v: string | undefined;
    for (const t of texts) for (const m of t.matchAll(re)) v = (m[1] ?? m[0]).trim();
    return v;
  };
  const slots: string[] = [];
  const phone = lastMatch(customer, /(?:\+?88)?(01[3-9]\d{8})/g);
  if (phone) slots.push(`phone: ${phone}`);
  const name = lastMatch(customer, /(?:amar naam|amar nam|my name is|i am|আমার নাম)\s+([A-Za-zঀ-৿]+(?:\s+[A-Za-zঀ-৿]+)?)/gi);
  if (name) slots.push(`name: ${name}`);
  const address = lastMatch(customer, /((?:address\s*[:\-]?\s*|ঠিকানা\s*[:\-]?\s*)?(?:house|flat|holding|বাসা)\s*[#:]?\s*\w+[^\n]{3,80})/gi);
  if (address) slots.push(`address: ${address}`);
  let district: string | undefined;
  for (const t of customer) for (const w of t.split(/[\s,.;:!?।]+/)) {
    const d = findDistrict(w);
    if (d) district = d.district;
  }
  if (district) slots.push(`district: ${district}`);
  const size = lastMatch(customer, /\b(XXL|XL|L|M|S)\b(?=\s*(?:size|সাইজ))|(?:size|সাইজ)\s*(XXL|XL|L|M|S|\d{2})\b/gi) ?? lastMatch(customer, /\b(XXL|XL)\b/g);
  if (size) slots.push(`size_mentioned: ${size.toUpperCase()}`);
  const productWords = Object.keys(SEARCH_SYNONYMS).filter((k) => !COLOUR_WORDS.has(k));
  const products = [...new Set(customer.flatMap((t) => searchTokens(t)).filter((k) => productWords.includes(k)))];
  if (products.length) slots.push(`first_product_asked_for: ${products[0]}`, `products_discussed: ${products.slice(-3).join(", ")}`);
  const orderRefs = [...new Set(customer.flatMap((t) => t.match(/ORD-\d{4}-\d{6}/gi) || []))].slice(-3);
  if (orderRefs.length) slots.push(`order_numbers_the_customer_mentioned: ${orderRefs.join(", ")}`);
  const promise = lastMatch(agent, /([^.।\n]{0,80}\b(?:dibo|pathabo|pathiye dibo|janabo|will send|will share|জানাবো|পাঠাবো|পাঠিয়ে দেব)\b[^.।\n]{0,40})/gi);
  if (promise) slots.push(`your_open_promise: "${promise}"`);
  return slots;
}

/** The server's view of this chat, given to the model as authoritative. */
export function sessionState(pr: CustomerAgentPrincipal, currentText: string): string {
  const lines: string[] = [];
  lines.push(
    replyScript(currentText) === "bangla"
      ? "reply_script: bangla (the customer wrote in Bangla script; reply in Bangla script)"
      : "reply_script: latin (the customer wrote in English letters; reply only in English letters: Banglish if they wrote Banglish, English if they wrote English)"
  );
  const orders = visibleOrders(pr, 3);
  lines.push(`customer_linked: ${pr.customerId && pr.assurance !== "ANONYMOUS" ? "yes" : "no"}`);
  if (orders.length) lines.push(`own_recent_orders: ${orders.map((o) => `${o.order_number} (${o.status})`).join("; ")}`);
  const slots = conversationSlots(pr);
  if (slots.length) lines.push(`customer_stated_in_this_chat (unverified; if the latest message says otherwise, the latest message wins):\n  ${slots.join("\n  ")}`);
  const open = db
    .getConversationQuotes(pr.tenantId, pr.conversationId)
    .filter((q) => q.status === "QUOTED" && Date.parse(q.expires_at) > Date.now())
    .pop();
  lines.push(open ? `open_quote: ${open.id}, grand total ৳${open.grand_total}, district ${open.district}, waiting for the customer's yes` : "open_quote: none");
  return lines.join("\n");
}

function recordToolCall(pr: CustomerAgentPrincipal, runId: string, name: string, args: unknown, outcome: { ok: boolean; refused?: string; result: ToolResult }, ms: number) {
  db.createAgentToolCall({
    id: `tcall_${randomUUID().slice(0, 12)}`,
    tenant_id: pr.tenantId,
    agent_run_id: runId,
    conversation_id: pr.conversationId,
    tool_name: name,
    // Arguments may hold the customer's phone and address: store only their keys (F25)
    input_arguments: Object.fromEntries(Object.keys((args as Record<string, unknown>) ?? {}).map((k) => [k, "[redacted]"])),
    status: outcome.refused ? "POLICY_REJECTED" : outcome.ok ? "SUCCESS" : "ERROR",
    duration_ms: ms,
    ...(outcome.ok ? {} : { error_message: String(outcome.result.error ?? "error") }),
    created_at: new Date().toISOString(),
  });
}

/**
 * One turn: answers the conversation's latest customer message. Never sends anything itself (the worker does) and never
 * throws for a model or tool failure: it hands off instead.
 */
/** Tools whose effect a customer or the team would see; in shadow mode they are not run (ADR-112). */
const SHADOW_BLOCKED_TOOLS = new Set(["place_order", "handoff_to_human"]);
const shadowResult = (name: string) => ({
  ok: false, refused: "SHADOW_MODE",
  result: { error: "SHADOW_MODE", status: "NOT_EXECUTED", message: `Shadow mode: ${name} was not run. Reply as if it would be.` } as ToolResult,
});

/**
 * One turn for the latest customer message. `shadow`: the draft is produced for review but nothing the customer or the
 * team would see happens (no order, no handoff); the caller doesn't send the reply.
 */
export async function runCustomerTurn(pr: CustomerAgentPrincipal, opts: { budgetMs?: number; shadow?: boolean } = {}): Promise<CustomerTurn> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? TURN_BUDGET_MS);
  const runId = `run_${randomUUID().slice(0, 16)}`;
  const recent = chatMessages(pr.tenantId, pr.conversationId, HISTORY_MESSAGES + 1); // oldest first
  const last = recent[recent.length - 1];
  const empty = (status: CustomerTurn["status"]): CustomerTurn => ({ runId, status, reply: "", handoff: false, toolCalls: [], guards: [], answeredMessageId: last?.id });
  if (!last || last.sender_type !== "CUSTOMER" || !last.text?.trim()) return empty("NOTHING_TO_ANSWER");

  const now = new Date().toISOString();
  db.createAgentRun({
    id: runId, tenant_id: pr.tenantId, conversation_id: pr.conversationId, agent_type: "CUSTOMER_AGENT", status: "RUNNING",
    current_step: "RECEIVE", model: "pending", prompt_version: PROMPT_VERSION, started_at: now, latency_ms: 0, input_tokens: 0,
    output_tokens: 0, estimated_cost_usd: 0, estimated_cost_bdt: 0, tool_calls_count: 0, created_at: now,
  });

  const current = cap(last.text, 4000);
  const script = replyScript(current);
  const state = sessionState(pr, current);
  const dynamic =
    `<store_context>\nshop_name: ${pr.tenantName}\ncurrency: BDT\nchannel: ${pr.channelType}\ntoday: ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })}\n</store_context>\n` +
    `<session_state source="server">\n${state}\n</session_state>`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt() },
    ...recent.slice(0, -1).map((m) => ({ role: (m.sender_type === "CUSTOMER" ? "user" : "assistant") as "user" | "assistant", content: cap(m.text, 1200) })),
    { role: "system", content: dynamic },
    { role: "user", content: current },
  ];
  const tools = Object.values(CUSTOMER_TOOLS).map((t) => t.def);
  const toolCalls: CustomerTurn["toolCalls"] = [];
  const toolResults: ToolResult[] = [];
  const placedOrderNumbers = db
    .getConversationQuotes(pr.tenantId, pr.conversationId)
    .filter((q) => q.status === "PLACED" && q.order_number)
    .map((q) => q.order_number as string);
  const guards: string[] = [];
  const seen = new Map<string, number>();
  let handoff = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let model = "unknown";
  let retriedShape = false;
  let retriedAmounts = false;

  const handOff = async (reason: string, summary: string) => {
    if (handoff) return;
    if (opts.shadow) {
      guards.push(`shadow_handoff:${reason}`);
      return;
    }
    const out = await runCustomerTool(pr, "handoff_to_human", { reason, summary });
    handoff = out.ok || handoff;
  };
  const finish = (status: CustomerTurn["status"], reply: string): CustomerTurn => {
    const { costUsd, costBdt } = modelRouter.calculateCost("TIER_1_FAST", promptTokens, completionTokens, cachedTokens);
    db.updateAgentRun(pr.tenantId, runId, {
      status: status === "COMPLETED" ? "COMPLETED" : status === "ESCALATED" ? "ESCALATED" : "FAILED",
      current_step: handoff ? "HUMAN_HANDOFF" : "RESPOND", completed_at: new Date().toISOString(), latency_ms: Date.now() - started,
      input_tokens: promptTokens, output_tokens: completionTokens, estimated_cost_usd: costUsd, estimated_cost_bdt: costBdt,
      tool_calls_count: toolCalls.length, final_response: reply, model, metadata: { guards, cached_tokens: cachedTokens },
    });
    db.recordAIUsage({
      id: `usg_${randomUUID().slice(0, 16)}`, tenant_id: pr.tenantId, agent_run_id: runId, conversation_id: pr.conversationId,
      agent_type: "CUSTOMER_AGENT", model, provider: "customer-agent", prompt_tokens: promptTokens, completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens, cached_tokens: cachedTokens, estimated_cost_usd: costUsd, estimated_cost_bdt: costBdt,
      currency: "BDT", timestamp: new Date().toISOString(),
    });
    return { runId, status, reply, handoff, toolCalls, guards, answeredMessageId: last.id };
  };
  const fallbackReply = () =>
    script === "bangla"
      ? "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। আমাদের টিমের একজন শীঘ্রই এখানে উত্তর দেবেন।"
      : "Dukkhito, ekhon uttor dite parchi na. Amader team er ekjon shiggiri ekhane reply dibe.";

  try {
    for (let call = 0; call < MAX_MODEL_CALLS && Date.now() < deadline; call++) {
      const res = await modelRouter.chatWithRouting("TIER_1_FAST", messages, tools, { deadlineMs: deadline, maxTokens: 2048 });
      model = res.model;
      promptTokens += res.usage.prompt_tokens;
      completionTokens += res.usage.completion_tokens;
      cachedTokens += res.usage.cached_tokens ?? 0;

      if (!res.tool_calls?.length) {
        // ---- the output pipeline (FX-78)
        let text = res.content || "";
        if (notAMessage(text)) {
          guards.push("not_a_message");
          if (!retriedShape) {
            retriedShape = true;
            messages.push({ role: "system", content: "Your last output was not a message to the customer. Reply to the customer in plain text." });
            continue;
          }
          break; // → handoff below
        }
        text = sanitizeOutbound(text);
        const phones = guardPhoneNumbers(pr.tenantId, pr.conversationId, text);
        if (phones.removed) {
          guards.push("number_removed");
          logger.warn("agent.output.number_removed", { tenant_id: pr.tenantId, conversation_id: pr.conversationId, count: phones.removed });
        }
        text = phones.text;
        const bad = unsupportedAmounts(text, allowedAmounts([...toolResults, state]));
        if (bad.length && !retriedAmounts) {
          retriedAmounts = true;
          guards.push("amount_retry");
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "system", content: `These amounts didn't come from a tool result this turn: ${bad.join(", ")}. Rewrite the reply using only amounts from tool results, or call quote_order.` });
          continue;
        }
        if (bad.length) {
          guards.push("amount_stripped");
          text = stripAmounts(text, bad);
        }
        const claim = guardOrderClaim(text, placedOrderNumbers, script);
        if (claim.blocked) {
          guards.push("order_claim_blocked");
          logger.warn("agent.output.order_claim_blocked", { tenant_id: pr.tenantId, conversation_id: pr.conversationId });
        }
        const payment = guardPaymentClaim(claim.text, script);
        if (payment.blocked) {
          guards.push("payment_claim_blocked");
          logger.warn("agent.output.payment_claim_blocked", { tenant_id: pr.tenantId, conversation_id: pr.conversationId });
        }
        text = capLength(payment.text);
        if (!text) break;
        // A reply that promises a person is made true by a real handoff, never left as an empty promise
        if (!handoff && PROMISES_HUMAN.test(text)) {
          guards.push("handoff_promise_kept");
          await handOff("other", "The agent's reply promised a team member; handoff done by the runtime.");
        }
        return finish(handoff ? "ESCALATED" : "COMPLETED", text);
      }

      messages.push({ role: "assistant", content: res.content || "", tool_calls: res.tool_calls });
      for (const tc of res.tool_calls) {
        const sig = `${tc.name}:${JSON.stringify(tc.arguments)}`;
        seen.set(sig, (seen.get(sig) || 0) + 1);
        const t0 = Date.now();
        let outcome: { ok: boolean; refused?: string; result: ToolResult };
        if (toolCalls.length >= MAX_TOOL_CALLS) {
          outcome = { ok: false, refused: "TOOL_BUDGET", result: { error: "TOOL_BUDGET_EXHAUSTED", message: "Answer with what you have or hand off." } };
        } else if ((seen.get(sig) || 0) > 2) {
          outcome = { ok: false, refused: "DUPLICATE", result: { error: "DUPLICATE_CALL", message: "You already have this result." } };
        } else if (opts.shadow && SHADOW_BLOCKED_TOOLS.has(tc.name)) {
          outcome = shadowResult(tc.name);
        } else {
          outcome = await runCustomerTool(pr, tc.name, tc.arguments);
        }
        recordToolCall(pr, runId, tc.name, tc.arguments, outcome, Date.now() - t0);
        toolCalls.push({ name: tc.name, ok: outcome.ok, ...(outcome.refused ? { refused: outcome.refused } : {}) });
        toolResults.push(outcome.result);
        if (tc.name === "handoff_to_human" && outcome.ok) handoff = true;
        if (tc.name === "place_order" && outcome.result.status === "PLACED" && typeof outcome.result.order_number === "string") {
          placedOrderNumbers.push(outcome.result.order_number);
        }
        messages.push({ role: "tool", name: tc.name, tool_call_id: tc.id, content: JSON.stringify(outcome.result) });
      }
    }
  } catch (err) {
    // Provider down, busy or out of time: the customer gets the standard reply and a person takes over
    logger.warn("customer_agent.turn_failed", { tenant_id: pr.tenantId, conversation_id: pr.conversationId, code: (err as { code?: string }).code ?? "ERROR" });
    guards.push(`provider_failed:${(err as { code?: string }).code ?? "ERROR"}`);
  }
  await handOff("could_not_answer", "The agent couldn't finish this reply; please take over.");
  return finish("FAILED", fallbackReply());
}
