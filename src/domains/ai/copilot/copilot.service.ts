/**
 * CommerceOS Phase 4: AI Copilot Service
 * Powers interactive AI reply generation for human operators. It only suggests: a suggestion never writes
 * (FX-69; the old approveAction, which ran any tool name it was given, is gone — FX-67).
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AgentRuntime } from "../runtime/agent-runtime";
import { BadRequestError } from "@/lib/errors";

export interface CopilotSuggestionResult {
  suggestion: string;
  suggested_reply: string;
  /** No calibrated confidence exists yet, so none is reported (FX-69; it used to be a constant 0.95). */
  confidence: number | null;
  intent: string;
  agent_type: string;
  citations: Array<{ title: string; section: string }>;
  draft_action?: {
    tool_name: string;
    description: string;
    payload: Record<string, unknown>;
  };
  generated_at: string;
}

export class CopilotService {
  /**
   * Generates suggested AI reply for human operator review
   */
  public static async generateSuggestion(
    context: RequestContext,
    conversationId: string
  ): Promise<CopilotSuggestionResult> {
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

    const { messages } = db.getMessages(context.tenant.id, conversationId, { limit: 10 });
    const lastCustomerMsg = [...messages].reverse().find((m) => m.sender_type === "CUSTOMER");

    if (!lastCustomerMsg) {
      throw new BadRequestError("Cannot generate Copilot suggestion without customer messages.");
    }

    // Run agent in simulation mode with copilot flag: nothing is sent, and the agent only gets read-only tools (FX-69)
    const result = await AgentRuntime.run(context, {
      conversationId,
      messageText: lastCustomerMsg.text,
      simulateOnly: true,
      isCopilot: true,
    });

    return {
      suggestion: result.finalResponse,
      suggested_reply: result.finalResponse,
      confidence: null,
      intent: result.intent,
      agent_type: result.agentType,
      citations: result.citations.map((c) => ({
        title: c.document_title,
        section: c.section,
      })),
      generated_at: new Date().toISOString(),
    };
  }

}
