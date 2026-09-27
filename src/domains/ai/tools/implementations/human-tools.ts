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
    options?: { conversationId?: string; idempotencyKey?: string }
  ) {
    if (options?.conversationId) {
      const convo = db.findConversationById(context.tenant.id, options.conversationId);
      if (convo) {
        db.updateConversation(context.tenant.id, convo.id, {
          mode: "HUMAN",
          automation_paused: true,
          status: "WAITING_AGENT",
          priority: input.priority,
        });

        await MessageService.createInternalNote(
          context,
          convo.id,
          `[AI Escalation] Handoff triggered.\nReason: ${input.reason}\nSummary: ${input.summary}${
            input.suggested_action ? `\nSuggested Action: ${input.suggested_action}` : ""
          }`
        );
      }
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
