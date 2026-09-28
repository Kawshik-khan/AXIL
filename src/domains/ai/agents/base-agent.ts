/**
 * CommerceOS Phase 4: Base Agent Implementation
 * Provides robust multi-step tool execution loop with loop protection, timeouts, and token budgeting.
 */

import { AgentType, AgentContext } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { modelRouter, ModelTier } from "@/domains/ai/providers/model-router";
import { toolRegistry } from "@/domains/ai/tools/tool-registry";
import { PromptRegistry } from "@/domains/ai/prompts/prompt-registry";
import { ContextBuilder } from "@/domains/ai/context/context-builder";
import { LLMMessage } from "@/domains/ai/providers/llm-provider.interface";

export interface AgentExecutionResult {
  finalResponse: string;
  toolCallsCount: number;
  handoffRequired: boolean;
  handoffReason?: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  model: string;
}

export abstract class BaseAgent {
  public abstract readonly agentType: AgentType;
  public abstract readonly allowedTools: string[];
  public abstract readonly modelTier: ModelTier;
  public readonly maxIterations: number = 5;
  public readonly maxToolCalls: number = 6;
  public readonly timeoutMs: number = 15000;

  /**
   * Executes multi-step reasoning and tool-calling loop
   */
  public async execute(
    context: RequestContext,
    agentContext: AgentContext,
    inputQuery: string,
    runId: string
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const systemPrompt =
      PromptRegistry.renderSystemPrompt(this.agentType) +
      "\n\n" +
      ContextBuilder.formatPromptContext(agentContext);

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      ...agentContext.recent_messages.map((m) => ({
        role: (m.sender_type === "CUSTOMER" ? "user" : "assistant") as "user" | "assistant",
        content: m.text,
      })),
      { role: "user", content: inputQuery },
    ];

    const llmToolDefs = toolRegistry.getLLMToolDefinitions(this.allowedTools);

    let iterations = 0;
    let totalToolCalls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let handoffRequired = false;
    let handoffReason: string | undefined = undefined;
    let finalResponse = "";
    const executedToolSignatures: string[] = [];

    while (iterations < this.maxIterations) {
      iterations++;

      // Check timeout budget
      if (Date.now() - startTime > this.timeoutMs) {
        finalResponse = "আপনার অনুরোধটি প্রসেস করতে কিছুটা অতিরিক্ত সময় লাগছে। আমি একজন মানব প্রতিনিধির কাছে এটি হস্তান্তর করছি।";
        handoffRequired = true;
        handoffReason = "AI_TOOL_TIMEOUT: Maximum agent execution time exceeded.";
        break;
      }

      // 1. Model Reasoning Step
      const response = await modelRouter.chatWithRouting(this.modelTier, messages, llmToolDefs);
      promptTokens += response.usage.prompt_tokens;
      completionTokens += response.usage.completion_tokens;

      // 2. Check for Tool Invocations
      if (response.tool_calls && response.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: response.content || "",
          tool_calls: response.tool_calls, // sent back with the results (FX-32)
        });

        for (const tc of response.tool_calls) {
          totalToolCalls++;

          // Loop Protection: Detect 3 identical consecutive or duplicate tool calls
          const signature = `${tc.name}:${JSON.stringify(tc.arguments)}`;
          const occurrences = executedToolSignatures.filter((s) => s === signature).length;
          if (occurrences >= 2) {
            finalResponse = "আমি সরাসরি প্রয়োজনীয় তথ্য যাচাই করতে পারছি না। একজন মানব প্রতিনিধি আপনাকে দ্রুত সহায়তা করবেন।";
            handoffRequired = true;
            handoffReason = "AI_MAX_ITERATIONS: Repeated identical tool loop detected.";
            break;
          }
          executedToolSignatures.push(signature);

          if (totalToolCalls > this.maxToolCalls) {
            finalResponse = "অনুরোধটি সম্পন্ন করতে একাধিক যাচাই প্রয়োজন। আমাদের সাপোর্ট টিম এটি দেখছে।";
            handoffRequired = true;
            handoffReason = "AI_MAX_ITERATIONS: Maximum allowed tool call limit reached.";
            break;
          }

          // Execute Tool via Tool Gateway
          const toolResult = await toolRegistry.executeTool(context, {
            toolName: tc.name,
            arguments: tc.arguments,
            agentRunId: runId,
            conversationId: agentContext.conversation_id,
          });

          // Check if tool triggered human handoff
          if (tc.name === "request_human_handoff" || (toolResult.result && toolResult.result.handoff_successful)) {
            handoffRequired = true;
            handoffReason = tc.arguments.reason as string || "Human handoff requested by agent.";
          }

          messages.push({
            role: "tool",
            name: tc.name,
            tool_call_id: tc.id,
            content: JSON.stringify(toolResult.result || { error: toolResult.error }),
          });
        }

        if (handoffRequired) {
          finalResponse = response.content || "আমি একজন কাস্টমার সাপোর্ট প্রতিনিধির সাথে আপনাকে যুক্ত করে দিচ্ছি। অনুগ্রহ করে অপেক্ষা করুন।";
          break;
        }

        // Continue reasoning with tool observations
        continue;
      }

      // 3. Terminal Text Response
      finalResponse = response.content;
      break;
    }

    if (!finalResponse) {
      finalResponse = "আপনার বার্তাটির উত্তর প্রস্তুত করা যায়নি। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।";
    }

    return {
      finalResponse,
      toolCallsCount: totalToolCalls,
      handoffRequired,
      handoffReason,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - startTime,
      model: modelRouter.resolveModelName(this.modelTier),
    };
  }
}
