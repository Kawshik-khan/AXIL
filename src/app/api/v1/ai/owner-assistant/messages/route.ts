import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { parseOrThrow, readJson } from "@/lib/validation";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";
import {
  answerQuestion,
  dashboardChatKey,
  MAX_QUESTION_CHARS,
  ownerPrincipalFor,
  saveTurn,
} from "@/domains/ai/owner-assistant/owner-assistant.service";
import { ForbiddenError } from "@/lib/errors";

/**
 * Owner Assistant chat on the dashboard (ADR-127). Each person has their own chat (`user:<id>`); the tenant and the
 * person come from the session only. Answers are read-only and use only the tools the person's role allows.
 */

const view = (t: { id: string; question: string; answer?: string; status: string; mode?: string; tools_used?: string[]; created_at: string; answered_at?: string }) => ({
  id: t.id,
  question: t.question,
  answer: t.answer ?? null,
  status: t.status,
  mode: t.mode ?? null,
  tools_used: t.tools_used ?? [],
  created_at: t.created_at,
  answered_at: t.answered_at ?? null,
});

/** The person's own chat, oldest first. Read-only. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);
    const turns = db.getOwnerAssistantTurns(context.tenant.id, dashboardChatKey(context.user.id), 30);
    return apiSuccess({ turns: turns.map(view) });
  } catch (err) {
    return apiError(err);
  }
}

const Ask = z.object({ question: z.string().trim().min(1).max(MAX_QUESTION_CHARS) }).strict();

/** Asks a question. The answer is computed outside the store lock, then saved in one short unit. */
async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);
    if (context.impersonation) throw new ForbiddenError("Support sessions can't use the assistant.");
    const { question } = parseOrThrow(Ask, await readJson(request));
    await enforceRateLimit(`owner-assistant:user:${context.tenant.id}:${context.user.id}`, 20, 10 * MINUTE);

    const principal = ownerPrincipalFor(context.tenant.id, context.user.id);
    if (!principal) throw new ForbiddenError("You are not an active member of this workspace.");
    const chatKey = dashboardChatKey(context.user.id);
    const history = db.getOwnerAssistantTurns(context.tenant.id, chatKey, 6).filter((t) => t.status === "ANSWERED");
    const startedAt = Date.now();
    const result = await answerQuestion(principal, question, { history, deadlineMs: startedAt + 30_000, signal: request.signal });
    const turn = await db.unit(
      async () => saveTurn({ tenantId: context.tenant.id, channel: "DASHBOARD", chatKey, userId: context.user.id, question, result, startedAt }),
      () => true,
    );
    return apiSuccess({ turn: view(turn), note: result.note ?? null }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

/** Forgets the person's own dashboard chat. */
async function handleDELETE(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);
    const removed = db.deleteOwnerAssistantTurns(context.tenant.id, dashboardChatKey(context.user.id));
    return apiSuccess({ removed });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST, { unit: false }); // the model call never holds the store lock
export const DELETE = withStore("DELETE", handleDELETE);
