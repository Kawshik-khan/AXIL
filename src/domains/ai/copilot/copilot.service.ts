import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 4: AI Copilot Service
 * Powers interactive AI reply generation and draft action approval for human operators.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AgentRuntime } from "../runtime/agent-runtime";
import { toolRegistry } from "../tools/tool-registry";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export interface CopilotSuggestionResult {
  suggestion: string;
  suggested_reply: string;
  confidence: number;
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

    // Run agent in simulation mode with copilot flag (does not deliver outbound message)
    const result = await AgentRuntime.run(context, {
      conversationId,
      messageText: lastCustomerMsg.text,
      simulateOnly: true,
      isCopilot: true,
    });

    return {
      suggestion: result.finalResponse,
      suggested_reply: result.finalResponse,
      confidence: 0.95,
      intent: result.intent,
      agent_type: result.agentType,
      citations: result.citations.map((c) => ({
        title: c.document_title,
        section: c.section,
      })),
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Approves and executes an AI proposed action (e.g. creating an order draft)
   */
  public static async approveAction(
    context: RequestContext,
    params: {
      conversationId: string;
      actionName: string;
      arguments: Record<string, unknown>;
    }
  ): Promise<{ success: boolean; result: any }> {
    RbacService.assertCan(context, PERMISSIONS.AI_RUN);

    const convo = db.findConversationById(context.tenant.id, params.conversationId);
    if (!convo) {
      throw new NotFoundError(`Conversation '${params.conversationId}' not found.`);
    }

    const runId = `capp_${Date.now()}_${randomSuffix()}`;
    const exec = await toolRegistry.executeTool(context, {
      toolName: params.actionName,
      arguments: params.arguments,
      agentRunId: runId,
      conversationId: params.conversationId,
    });

    return exec;
  }
}
