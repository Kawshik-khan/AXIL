/**
 * One step from a failed production conversation to an eval case (prompt §F "Replay").
 *
 *   node tests/ts-runner.cjs ./scripts/export-conversation-to-case.ts <tenantId> <conversationId> [caseId] >> tests/agent-evals/golden.jsonl
 *
 * Reads the conversation from whatever store the environment selects (in production: run it on a Neon branch copy,
 * never against the live database). The last customer message becomes the input, everything before it the history.
 * PII is redacted: phone numbers, emails and card-like numbers via PIIRedactionService, then any remaining 11-digit
 * BD mobile and street-address fragments. What the agent did (reply, tools) is attached as `observed` so the person
 * filing it only has to write `expect`. The case is marked `needs_review: true` and is skipped by the gate until then.
 */
import { db } from "@/infrastructure/db";
import { PIIRedactionService } from "@/domains/ai/context/pii-redaction.service";

export function redact(text: string): string {
  return PIIRedactionService.redactText(text)
    .replace(/(?:\+?88)?01[3-9][\d*]{8}/g, "01XXXXXXXXX") // also the app's partial mask (0171****001 keeps 7 digits)
    .replace(/\b(?:house|flat|holding|road|block|sector)\s*[#:]?\s*[\w-]+/gi, (m) => m.split(/\s+/)[0] + " X");
}

export function exportCase(tenantId: string, conversationId: string, caseId?: string) {
  const conversation = db.findConversationById(tenantId, conversationId);
  if (!conversation) throw new Error(`Conversation ${conversationId} not found in tenant ${tenantId}`);
  const messages = db.getMessages(tenantId, conversationId, { limit: 200 }).messages;
  const lastCustomer = [...messages].reverse().findIndex((m) => m.sender_type === "CUSTOMER");
  if (lastCustomer < 0) throw new Error("No customer message to replay");
  const cut = messages.length - 1 - lastCustomer;
  const runs = (db as unknown as { data: { agent_runs?: Array<{ id: string; tenant_id: string; conversation_id: string; final_response?: string; agent_type?: string; created_at: string }> } }).data.agent_runs ?? [];
  const lastRun = runs.filter((r) => r.tenant_id === tenantId && r.conversation_id === conversationId).sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
  const tools = lastRun ? db.getAgentToolCalls(tenantId, lastRun.id).map((c) => ({ name: c.tool_name, status: c.status })) : [];
  return {
    id: caseId ?? `P-${conversationId.slice(-8)}`,
    category: "production_replay",
    needs_review: true,
    source: { tenant: "redacted", conversation_ref: conversationId.slice(-8), exported_at: new Date().toISOString().slice(0, 10) },
    anonymous: !conversation.customer_id,
    history: messages.slice(0, cut).slice(-20).map((m) => ({ from: m.sender_type === "CUSTOMER" ? "customer" : "agent", text: redact(m.text) })),
    inputs: [redact(messages[cut].text)],
    observed: { agent: lastRun?.agent_type, reply: redact(lastRun?.final_response ?? ""), tools },
    expect: {},
  };
}

if (require.main === module || process.argv[1]?.endsWith("ts-runner.cjs")) {
  const [tenantId, conversationId, caseId] = process.argv.slice(3);
  if (tenantId && conversationId) {
    Promise.resolve((db as unknown as { ready?: () => Promise<void> }).ready?.()).then(() => {
      process.stdout.write(JSON.stringify(exportCase(tenantId, conversationId, caseId)) + "\n");
      process.exit(0);
    }).catch((e) => { process.stderr.write(String(e) + "\n"); process.exit(1); });
  }
}
