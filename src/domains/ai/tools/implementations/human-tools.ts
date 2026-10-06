/**
 * CommerceOS Phase 4: Human Handoff Tool
 * Immediate escalation of conversation to human operators with automation lock.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { MessageService } from "@/domains/social/messages/message.service";
import { slaDueAt, type HandoffCard } from "@/domains/ai/customer-agent/handoff-card";

const RequestHumanHandoffInputSchema = z.object({
  reason: z.string().describe("Explicit reason for human handoff"),
  summary: z.string().describe("Context summary of customer issue"),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  suggested_action: z.string().optional().describe("Recommended next step for the human operator"),
});

export class RequestHumanHandoffTool implements IAgentTool<z.infer<typeof RequestHumanHandoffInputSchema>> {
  public readonly name = "request_human_handoff";
  public readonly description = "Transfer conversation to a human support agent and lock automated AI responses.";
  public readonly category = "HUMAN";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.SOCIAL_CONVERSATION_ASSIGN;
  public readonly requiresConfirmation = false;
  public readonly schema = RequestHumanHandoffInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Handoff reason" },
          summary: { type: "string", description: "Context summary" },
          priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
          suggested_action: { type: "string" },
        },
        required: ["reason", "summary"],
      },
      timeout_ms: 3000,
      idempotent: this.idempotent,
    };
  }

  public async execute(
    context: RequestContext,
    input: z.infer<typeof RequestHumanHandoffInputSchema>,
    options?: { conversationId?: string; idempotencyKey?: string; card?: Partial<HandoffCard> }
  ) {
    if (options?.conversationId) {
      const conversationId = options.conversationId;
      // FX-84: the note and the mode change land together or not at all. The note is written first, so a failure
      // leaves the chat with the bot rather than paused with no note telling staff why.
      const work = async () => {
        const convo = db.findConversationById(context.tenant.id, conversationId);
        if (!convo) return false;
        await MessageService.createInternalNote(
          context,
          convo.id,
          `[AI Escalation] Handoff triggered.\nReason: ${input.reason}\nSummary: ${input.summary}${
            input.suggested_action ? `\nSuggested Action: ${input.suggested_action}` : ""
          }`
        );
        const now = Date.now();
        const card: HandoffCard = {
          reason: input.reason,
          summary: input.summary,
          priority: input.priority,
          ...(input.suggested_action ? { suggested_action: input.suggested_action } : {}),
          slots: [],
          order_refs: [],
          script: "latin",
          ...options.card,
          created_at: new Date(now).toISOString(),
          sla_due_at: slaDueAt(input.priority, now),
        };
        db.updateConversation(context.tenant.id, convo.id, {
          mode: "HUMAN",
          automation_paused: true,
          status: "WAITING_AGENT",
          priority: input.priority,
          metadata: { ...convo.metadata, handoff_card: card },
        });
        return true;
      };
      // Inside a request the request's unit makes it atomic; from the agent worker it gets its own
      if (db.isInUnit()) await work();
      else await db.unit(work, () => true);
    }

    return {
      handoff_successful: true,
      mode: "HUMAN",
      automation_paused: true,
      status: "WAITING_AGENT",
      reason: input.reason,
      message: "Human takeover initiated. Automation is paused. Customer will be notified.",
    };
  }
}
