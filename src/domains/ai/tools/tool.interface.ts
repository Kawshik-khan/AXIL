/**
 * CommerceOS Phase 4: Agent Tool Interface & Protocol
 */

import { z } from "zod";
import { RequestContext } from "@/lib/context";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";

export interface IAgentTool<TInput = any, TOutput = any> {
  readonly name: string;
  readonly description: string;
  readonly category: ToolDefinition["category"];
  readonly riskLevel: ToolRiskLevel;
  readonly requiredPermission: string;
  readonly requiresConfirmation: boolean;
  readonly schema: z.ZodTypeAny;
  readonly idempotent: boolean;

  getDefinition(): ToolDefinition;

  execute(
    context: RequestContext,
    input: TInput,
    options?: { conversationId?: string; idempotencyKey?: string }
  ): Promise<TOutput>;
}
