/**
 * Owner Assistant (ADR-127): answers the shop owner's questions about their own business, read-only.
 *
 * - `answerQuestion` reads only (tools, model): it never writes the store, so callers run it outside any store unit
 *   (the dashboard route is `{ unit: false }`, Telegram questions are answered by the background worker).
 * - `saveTurn` records the question, the answer, the agent run and its usage in one short unit.
 * - The model sees only the tools the person's role allows. Every number in a model answer is checked against that
 *   turn's tool results; an answer with a number no tool returned is retried once, then replaced by the offline answer.
 * - No model configured, the AI budget spent, or the model failing: the offline answer (fixed wording, store numbers).
 */
import { randomUUID } from "crypto";
import { db } from "@/infrastructure/db";
import { modelRouter } from "@/domains/ai/providers/model-router";
import type { LLMMessage } from "@/domains/ai/providers/llm-provider.interface";
import { PromptInjectionClassifier } from "@/domains/ai/safety/prompt-injection";
import { AiBudgetGuard } from "@/domains/ai/safety/budget-guard";
import { PlatformEntitlementService } from "@/domains/platform/services/platform-entitlement.service";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import type { OwnerAssistantChannel, OwnerAssistantTurnRecord } from "@/types/owner-assistant";
import { OWNER_ADVISOR_PROMPT_VERSION, OWNER_ADVISOR_SYSTEM_PROMPT } from "./prompt";
import { runOwnerTool, toolsFor, type OwnerPrincipal, type OwnerToolResult } from "./owner-tools";
import { checkGrounding } from "./grounding";
import { basicAnswer, scriptOf } from "./basic-answer";
import { localDate } from "./periods";

export type { OwnerPrincipal } from "./owner-tools";

const MAX_MODEL_CALLS = 4;
const MAX_TOOL_CALLS = 6;
const HISTORY_TURNS = 6;
export const MAX_QUESTION_CHARS = 1000;
/** Telegram's limit is 4096; leave room. */
export const MAX_ANSWER_CHARS = 3500;

export interface AnswerResult {
  answer: string;
  mode: "LIVE" | "BASIC" | "REFUSED";
  toolsUsed: string[];
  ungrounded: string[];
  usage?: { model: string; promptTokens: number; completionTokens: number; cachedTokens: number; costUsd: number; costBdt: number; provider: string };
  /** Why the answer is not the model's, when it isn't. */
  note?: string;
}

/**
 * The principal for a workspace member: their current role's permissions in that workspace, or undefined when they
 * are no longer an active member (a linked Telegram chat then stops answering).
 */
export function ownerPrincipalFor(tenantId: string, userId: string): OwnerPrincipal | undefined {
  const tenant = db.findTenantById(tenantId);
  const user = db.findUserById(userId);
  const membership = db.findMembership(tenantId, userId);
  // A suspended workspace gets no answers anywhere, as a session would be refused (security review M1)
  if (!tenant || tenant.status !== "ACTIVE" || !user || user.status !== "ACTIVE" || !membership || membership.status === "SUSPENDED") return undefined;
  const permissions = (ROLE_PERMISSIONS[membership.role] ?? []) as readonly Permission[];
  return { tenantId, tenantName: tenant.name, timezone: tenant.timezone || "Asia/Dhaka", userId, permissions };
}

function refusal(question: string, kind: "injection" | "no_access" | "limit" | "paused" | "empty"): AnswerResult {
  const b = scriptOf(question) === "bangla";
  const text = {
    injection: b ? "আমি শুধু আপনার দোকানের ব্যবসার প্রশ্নের উত্তর দিতে পারি।" : "I can only answer questions about your shop's business.",
    no_access: b ? "আপনার রোলে ব্যবসার তথ্য দেখার অনুমতি নেই।" : "Your role can't see business numbers, so I can't answer this.",
    limit: b ? "এই মাসের AI ব্যবহারের সীমা শেষ হয়েছে।" : "This workspace has used its AI runs for this month.",
    paused: b ? "এই মুহূর্তে AI বন্ধ রাখা হয়েছে।" : "The AI is paused for this workspace right now.",
    empty: b
      ? "যেমন জিজ্ঞেস করুন: \"আজ কত বিক্রি হলো?\", \"কোন পণ্যের স্টক কম?\", \"গত সপ্তাহে কয়টা ডেলিভারি ফেরত এসেছে?\""
      : 'Ask me things like "How much did I sell today?", "What is low on stock?", "How many deliveries failed last week?"',
  }[kind];
  return { answer: text, mode: "REFUSED", toolsUsed: [], ungrounded: [] };
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface AnswerOptions {
  /** Earlier turns of this chat, oldest first (question/answer pairs). */
  history?: Array<Pick<OwnerAssistantTurnRecord, "question" | "answer">>;
  /** Absolute deadline for the whole answer (epoch ms). */
  deadlineMs?: number;
  /** Use the model. Default: only when a live model is configured. Tests set it with a stub provider. */
  liveModel?: boolean;
  signal?: AbortSignal;
}

export async function answerQuestion(pr: OwnerPrincipal, rawQuestion: string, opts: AnswerOptions = {}): Promise<AnswerResult> {
  const question = cap(rawQuestion.trim(), MAX_QUESTION_CHARS);
  if (!question) return refusal(rawQuestion, "empty");
  if (!pr.permissions.includes(PERMISSIONS.AI_RUN) || toolsFor(pr).length === 0) return refusal(question, "no_access");
  if (PlatformSafetyService.isExecutionBlocked("TENANT", pr.tenantId)) return refusal(question, "paused");
  if (PromptInjectionClassifier.analyze(question).isInjection) return refusal(question, "injection");

  const live = opts.liveModel ?? modelRouter.getMode() === "LIVE";
  const basic = async (note: string): Promise<AnswerResult> => {
    const b = await basicAnswer(pr, question);
    return { answer: cap(b.answer, MAX_ANSWER_CHARS), mode: "BASIC", toolsUsed: b.toolsUsed, ungrounded: [], note };
  };
  if (!live) return basic("NO_MODEL");
  if (!(await PlatformEntitlementService.can(pr.tenantId, "ai_monthly_runs"))) return refusal(question, "limit");
  if (!AiBudgetGuard.checkBudget(pr.tenantId).allowed) return basic("BUDGET");

  const deadline = opts.deadlineMs ?? Date.now() + 30_000;
  const tools = toolsFor(pr);
  const context =
    `<shop_context>\nshop_name: ${pr.tenantName}\ncurrency: BDT\ntimezone: ${pr.timezone}\n` +
    `today: ${localDate(pr.timezone, Date.now())}\ncan_see: ${tools.map((t) => t.def.name).join(", ")}\n</shop_context>`;
  const messages: LLMMessage[] = [
    { role: "system", content: OWNER_ADVISOR_SYSTEM_PROMPT },
    ...(opts.history ?? []).slice(-HISTORY_TURNS).flatMap((t): LLMMessage[] => [
      { role: "user", content: cap(t.question, 600) },
      ...(t.answer ? [{ role: "assistant" as const, content: cap(t.answer, 1200) }] : []),
    ]),
    { role: "system", content: context },
    { role: "user", content: question },
  ];

  const usage = { model: "unknown", promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, costBdt: 0, provider: "unknown" };
  const toolsUsed: string[] = [];
  const results: OwnerToolResult[] = [];
  let retriedGrounding = false;
  let toolCalls = 0;

  try {
    for (let call = 0; call < MAX_MODEL_CALLS && Date.now() < deadline; call++) {
      const res = await modelRouter.chatWithRouting(
        "TIER_1_FAST",
        messages,
        tools.map((t) => t.def),
        { deadlineMs: deadline, maxTokens: 700, ...(opts.signal ? { signal: opts.signal } : {}) },
      );
      usage.model = res.model;
      usage.provider = res.provider;
      usage.promptTokens += res.usage.prompt_tokens;
      usage.completionTokens += res.usage.completion_tokens;
      usage.cachedTokens += res.usage.cached_tokens ?? 0;
      usage.costUsd += res.costUsd;
      usage.costBdt += res.costBdt;

      if (res.tool_calls?.length) {
        messages.push({ role: "assistant", content: res.content || "", tool_calls: res.tool_calls });
        for (const tc of res.tool_calls) {
          if (toolCalls >= MAX_TOOL_CALLS) {
            messages.push({ role: "tool", name: tc.name, tool_call_id: tc.id, content: JSON.stringify({ error: "TOOL_LIMIT", message: "Answer with what you have." }) });
            continue;
          }
          toolCalls++;
          const out = await runOwnerTool(pr, tc.name, tc.arguments);
          toolsUsed.push(tc.name);
          if (out.ok) results.push(out.result);
          messages.push({ role: "tool", name: tc.name, tool_call_id: tc.id, content: JSON.stringify(out.result) });
        }
        continue;
      }

      const answer = (res.content || "").trim();
      if (!answer) break;
      const check = checkGrounding(answer, results, question);
      if (check.grounded) {
        return { answer: cap(answer, MAX_ANSWER_CHARS), mode: "LIVE", toolsUsed, ungrounded: [], usage };
      }
      if (!retriedGrounding) {
        retriedGrounding = true;
        messages.push({ role: "assistant", content: answer });
        messages.push({
          role: "system",
          content: `These numbers are not in any tool result of this turn: ${check.ungrounded.join(", ")}. Call the tools you need and answer again using only numbers the tools returned. Do not estimate.`,
        });
        continue;
      }
      logger.warn("owner_assistant.ungrounded_answer", { tenant_id: pr.tenantId, count: check.ungrounded.length });
      const fallback = await basic("UNGROUNDED");
      return { ...fallback, toolsUsed: [...toolsUsed, ...fallback.toolsUsed], ungrounded: check.ungrounded, usage };
    }
  } catch (err) {
    logger.warn("owner_assistant.model_failed", { tenant_id: pr.tenantId, code: (err as { code?: string }).code ?? "error" });
    const fallback = await basic("MODEL_FAILED");
    return { ...fallback, usage: usage.promptTokens ? usage : undefined };
  }
  const fallback = await basic("NO_FINAL_ANSWER");
  return { ...fallback, usage: usage.promptTokens ? usage : undefined };
}

/**
 * Records an answered turn: the turn row (inserted, or the pending Telegram one updated), and for model answers the
 * agent run, its usage and the workspace's AI spend. Call inside a store unit.
 */
export function saveTurn(input: {
  tenantId: string;
  channel: OwnerAssistantChannel;
  chatKey: string;
  userId: string;
  question: string;
  result: AnswerResult;
  existingTurnId?: string;
  startedAt: number;
}): OwnerAssistantTurnRecord {
  const now = new Date().toISOString();
  const { result } = input;
  let runId: string | undefined;
  if (result.usage) {
    runId = `run_${randomUUID().slice(0, 16)}`;
    const u = result.usage;
    db.createAgentRun({
      id: runId,
      tenant_id: input.tenantId,
      conversation_id: input.chatKey,
      agent_type: "OWNER_ASSISTANT",
      status: "COMPLETED",
      current_step: "RESPOND",
      model: u.model,
      prompt_version: OWNER_ADVISOR_PROMPT_VERSION,
      started_at: new Date(input.startedAt).toISOString(),
      completed_at: now,
      latency_ms: Date.now() - input.startedAt,
      input_tokens: u.promptTokens,
      output_tokens: u.completionTokens,
      estimated_cost_usd: u.costUsd,
      estimated_cost_bdt: u.costBdt,
      tool_calls_count: result.toolsUsed.length,
      // The answer is business data for this workspace only; the run keeps its length, not its text
      metadata: { channel: input.channel, mode: result.mode, answer_chars: result.answer.length, ungrounded: result.ungrounded.length, note: result.note },
      created_at: now,
    });
    db.recordAIUsage({
      id: `usg_${randomUUID().slice(0, 16)}`,
      tenant_id: input.tenantId,
      agent_run_id: runId,
      conversation_id: input.chatKey,
      agent_type: "OWNER_ASSISTANT",
      model: u.model,
      provider: u.provider,
      prompt_tokens: u.promptTokens,
      completion_tokens: u.completionTokens,
      total_tokens: u.promptTokens + u.completionTokens,
      cached_tokens: u.cachedTokens,
      estimated_cost_usd: u.costUsd,
      estimated_cost_bdt: u.costBdt,
      currency: "BDT",
      timestamp: now,
    });
    AiBudgetGuard.recordSpend(input.tenantId, u.promptTokens + u.completionTokens, u.costUsd);
  }
  const fields: Partial<OwnerAssistantTurnRecord> = {
    status: "ANSWERED",
    answer: result.answer,
    tools_used: result.toolsUsed,
    mode: result.mode,
    ungrounded_numbers: result.ungrounded.length ? result.ungrounded : undefined,
    agent_run_id: runId,
    answered_at: now,
    claimed_at: undefined,
    error_code: undefined,
  };
  if (input.existingTurnId) {
    const updated = db.updateOwnerAssistantTurn(input.tenantId, input.existingTurnId, fields);
    if (updated) return updated;
  }
  return db.insertOwnerAssistantTurn({
    id: `oat_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    tenant_id: input.tenantId,
    channel: input.channel,
    chat_key: input.chatKey,
    user_id: input.userId,
    question: cap(input.question.trim(), MAX_QUESTION_CHARS),
    created_at: new Date(input.startedAt).toISOString(),
    ...fields,
  } as OwnerAssistantTurnRecord);
}

export const dashboardChatKey = (userId: string) => `user:${userId}`;
export const telegramChatKey = (chatId: string) => `tg:${chatId}`;
