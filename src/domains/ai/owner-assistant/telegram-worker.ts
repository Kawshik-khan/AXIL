/**
 * Answers Owner Assistant questions asked in linked Telegram chats (ADR-127). The webhook only stores a PENDING turn;
 * this pass (run by the background worker loop) claims each one, re-checks that the chat is still linked and that the
 * person who linked it may still use the assistant, computes the answer outside any store unit, sends it, and saves it.
 */
import { db } from "@/infrastructure/db";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/permissions";
import { NotificationService, assistantSettingsOf, chatOnCurrentBot } from "@/domains/notifications/notification.service";
import { answerQuestion, ownerPrincipalFor, saveTurn, type AnswerResult } from "./owner-assistant.service";
import type { OwnerAssistantTurnRecord } from "@/types/owner-assistant";

/** A claim older than this is a worker that died while answering (well past the 25-second answer budget). */
const STALE_CLAIM_MS = 180_000;
const MAX_ATTEMPTS = 2;
const TURNS_PER_PASS = 5;
const ANSWER_BUDGET_MS = 25_000;

async function fail(turn: OwnerAssistantTurnRecord, code: string): Promise<void> {
  await db.unit(async () => {
    db.updateOwnerAssistantTurn(turn.tenant_id, turn.id, { status: "FAILED", error_code: code, claimed_at: undefined });
  }, () => true);
}

/** One pass. Exported for tests. */
export async function answerTelegramQuestionsOnce(limit = TURNS_PER_PASS): Promise<{ answered: number; failed: number }> {
  const stats = { answered: 0, failed: 0 };
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  for (const candidate of db.getDueOwnerAssistantTurns(staleBefore, limit)) {
    const turn = await db
      .unit(async () => {
        const current = db.findOwnerAssistantTurn(candidate.tenant_id, candidate.id);
        if (!current) return undefined;
        const due = current.status === "PENDING" || (current.status === "ANSWERING" && (current.claimed_at ?? "") < staleBefore);
        if (!due) return undefined;
        return db.updateOwnerAssistantTurn(current.tenant_id, current.id, {
          status: "ANSWERING",
          claimed_at: new Date().toISOString(),
          attempts: (current.attempts ?? 0) + 1,
        });
      }, (r) => r !== undefined)
      .catch(() => undefined); // another server claimed it
    if (!turn) continue;

    try {
      if ((turn.attempts ?? 0) > MAX_ATTEMPTS) {
        await fail(turn, "TOO_MANY_ATTEMPTS");
        stats.failed++;
        continue;
      }
      const chatId = turn.chat_key.startsWith("tg:") ? turn.chat_key.slice(3) : "";
      const record = db.findNotificationSettings(turn.tenant_id);
      // Still linked to this chat, questions still on, and the linker may still see the shop and use the AI
      const linkedHere = Boolean(chatId && record?.telegram?.chat_id === chatId && chatOnCurrentBot(record));
      const principal = linkedHere && record?.telegram ? ownerPrincipalFor(turn.tenant_id, record.telegram.linked_by_user_id) : undefined;
      const settings = assistantSettingsOf(record);
      // Telegram group and supergroup ids are negative: group questions must still be on (security review L4)
      const isGroup = chatId.startsWith("-");
      if (!linkedHere || !settings.questions_enabled || (isGroup && !settings.group_questions) || !principal || !principal.permissions.includes(PERMISSIONS.AI_RUN)) {
        await fail(turn, "NOT_ALLOWED");
        stats.failed++;
        continue;
      }

      const history = db
        .getOwnerAssistantTurns(turn.tenant_id, turn.chat_key, 8)
        .filter((t) => t.id !== turn.id && t.status === "ANSWERED");
      const startedAt = Date.now();
      const result: AnswerResult = await answerQuestion(principal, turn.question, { history, deadlineMs: startedAt + ANSWER_BUDGET_MS });

      // Saved before sending: a crash after this can lose the reply but never send it twice
      const saved = await db.unit(async () => {
        const stored = saveTurn({
          tenantId: turn.tenant_id,
          channel: "TELEGRAM",
          chatKey: turn.chat_key,
          userId: principal.userId,
          question: turn.question,
          result,
          existingTurnId: turn.id,
          startedAt,
        });
        if (stored) db.updateOwnerAssistantTurn(turn.tenant_id, turn.id, { error_code: "REPLY_PENDING" });
        return stored;
      }, () => true);
      if (!saved) {
        // Forgotten (/forget) while it was being answered: not stored, not sent
        stats.failed++;
        continue;
      }
      const sent = await NotificationService.replyInChat(turn.tenant_id, chatId, result.answer, turn.telegram_message_id);
      await db.unit(async () => {
        db.updateOwnerAssistantTurn(turn.tenant_id, turn.id, {
          error_code: sent.status === "SENT" ? undefined : sent.status === "NOT_SENT" ? "REPLY_NOT_SENT" : "REPLY_FAILED",
        });
      }, () => true);
      if (sent.status === "SENT") stats.answered++;
      else stats.failed++;
    } catch (err) {
      logger.warn("owner_assistant.telegram_turn_failed", { tenant_id: turn.tenant_id, error: (err as Error).name });
      // Left ANSWERING: retried after the claim goes stale, up to MAX_ATTEMPTS
      stats.failed++;
    }
  }
  return stats;
}
