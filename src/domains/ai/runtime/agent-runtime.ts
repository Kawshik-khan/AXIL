import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 4: Agent Runtime & State Machine
 * Deterministic 9-step agent lifecycle with strict grounding, safety, and budget enforcement.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import {
  AgentRun,
  AgentType,
  RetrievalCitation,
} from "@/types/ai";
import { AgentRouter } from "../router/agent-router";
import { ContextBuilder } from "../context/context-builder";
import { KnowledgeService } from "../rag/knowledge.service";
import { MemoryService } from "../memory/memory.service";
import { modelRouter } from "../providers/model-router";

// Specialized Agents
import { CustomerSupportAgent } from "../agents/customer-support.agent";
import { SalesAgent } from "../agents/sales.agent";
import { OrderAssistantAgent } from "../agents/order-assistant.agent";
import { ProductInfoAgent } from "../agents/product-info.agent";

// Safety & Tools
import { RequestHumanHandoffTool } from "../tools/implementations/human-tools";
import { COPILOT_READ_ONLY_TOOLS } from "../tools/tool-access";
import { PromptRegistry } from "../prompts/prompt-registry";

export interface AgentRunOptions {
  conversationId: string;
  messageText: string;
  simulateOnly?: boolean; // When true, does not send external social messages
  forcedAgent?: AgentType;
  isCopilot?: boolean; // When true, represents human operator assist in inbox
}

export interface AgentSimulationInput {
  context: RequestContext;
  messageText: string;
  channelType?: string;
  customerId?: string;
  customerName?: string;
  agentId?: AgentType;
  conversationId?: string;
}

export interface AgentRunOutput {
  runId: string;
  status: "COMPLETED" | "ESCALATED" | "FAILED" | "BLOCKED";
  intent: string;
  agentType: AgentType;
  finalResponse: string;
  toolCallsCount: number;
  handoffRequired: boolean;
  handoffReason?: string;
  isCopilotSuggestion: boolean;
  citations: RetrievalCitation[];
  tokensUsed: number;
  costUsd: number;
  costBdt: number;
  latencyMs: number;
}

export class AgentRuntime {
  private static supportAgent = new CustomerSupportAgent();
  private static salesAgent = new SalesAgent();
  private static orderAgent = new OrderAssistantAgent();
  private static productAgent = new ProductInfoAgent();

  /**
   * Main runtime entrypoint executing the 9-step state machine
   */
  public static async run(
    context: RequestContext,
    options: AgentRunOptions
  ): Promise<AgentRunOutput> {
    const startTime = Date.now();
    const tenantId = context.tenant.id;
    const policy = db.getAIPolicy(tenantId);

    const runId = `run_${Date.now()}_${randomSuffix()}`;

    // ----------------------------------------------------
    // STEP 1: RECEIVE & POLICY PRE-CHECK
    // ----------------------------------------------------
    const conversation = db.findConversationById(tenantId, options.conversationId);

    // Human takeover constraint: if conversation is in HUMAN mode or automation is paused, STOP (unless running as human Copilot assist)
    if (!options.isCopilot && conversation && (conversation.mode === "HUMAN" || conversation.automation_paused)) {
      return {
        runId,
        status: "BLOCKED",
        intent: "HUMAN_TAKEOVER_ACTIVE",
        agentType: "CUSTOMER_SUPPORT",
        finalResponse: "Automation is currently paused due to active human takeover.",
        toolCallsCount: 0,
        handoffRequired: true,
        handoffReason: "Conversation is in HUMAN mode. AI execution blocked.",
        isCopilotSuggestion: false,
        citations: [],
        tokensUsed: 0,
        costUsd: 0,
        costBdt: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    // Check Tenant AI Enabled Flag
    if (!policy.is_enabled) {
      return {
        runId,
        status: "BLOCKED",
        intent: "AI_DISABLED",
        agentType: "CUSTOMER_SUPPORT",
        finalResponse: "AI automation is currently disabled for this store.",
        toolCallsCount: 0,
        handoffRequired: false,
        isCopilotSuggestion: false,
        citations: [],
        tokensUsed: 0,
        costUsd: 0,
        costBdt: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    // Initialize AgentRun in DB
    const agentRun: AgentRun = {
      id: runId,
      tenant_id: tenantId,
      conversation_id: options.conversationId,
      agent_type: options.forcedAgent || "SUPERVISOR",
      status: "RUNNING",
      current_step: "RECEIVE",
      model: "pending",
      prompt_version: "pending", // set from the agent's prompt template once the agent is chosen (FX-70)
      started_at: new Date().toISOString(),
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      estimated_cost_bdt: 0,
      tool_calls_count: 0,
      created_at: new Date().toISOString(),
    };
    db.createAgentRun(agentRun);

    // ----------------------------------------------------
    // STEP 2: CLASSIFY INTENT & ROUTE
    // ----------------------------------------------------
    db.updateAgentRun(tenantId, runId, { current_step: "CLASSIFY" });

    const classification = await AgentRouter.route(
      context,
      options.conversationId,
      options.messageText,
      { isCopilot: options.isCopilot }
    );

    const targetAgentType = options.forcedAgent || classification.target_agent;
    db.updateAgentRun(tenantId, runId, {
      agent_type: targetAgentType,
      metadata: { classification },
    });

    // Check if classification requires immediate human handoff
    if (classification.requires_human || classification.confidence < policy.confidence_threshold_low) {
      // A copilot suggestion never writes (FX-69): the staff member is already handling the conversation.
      if (!options.isCopilot) {
        const handoffTool = new RequestHumanHandoffTool();
        await handoffTool.execute(
          context,
          {
            reason: `Router handoff: ${classification.intent} (confidence: ${classification.confidence})`,
            summary: options.messageText,
            priority: "NORMAL",
            suggested_action: "Review customer message and respond manually.",
          },
          { conversationId: options.conversationId }
        );
      }

      const latency = Date.now() - startTime;
      db.updateAgentRun(tenantId, runId, {
        status: "ESCALATED",
        current_step: "HUMAN_HANDOFF",
        completed_at: new Date().toISOString(),
        latency_ms: latency,
        final_response: "আমি একজন কাস্টমার সাপোর্ট প্রতিনিধির সাথে আপনাকে যুক্ত করে দিচ্ছি। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।",
      });

      return {
        runId,
        status: "ESCALATED",
        intent: classification.intent,
        agentType: targetAgentType,
        finalResponse: "আমি একজন কাস্টমার সাপোর্ট প্রতিনিধির সাথে আপনাকে যুক্ত করে দিচ্ছি। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।",
        toolCallsCount: options.isCopilot ? 0 : 1,
        handoffRequired: true,
        handoffReason: `Low confidence (${classification.confidence}) or sensitive intent (${classification.intent})`,
        isCopilotSuggestion: false,
        citations: [],
        // No agent model call happened on this path; the router's own usage isn't measured yet (FX-69, FX-81)
        tokensUsed: 0,
        costUsd: 0,
        costBdt: 0,
        latencyMs: latency,
      };
    }

    // ----------------------------------------------------
    // STEP 3: PLAN & SELECT AGENT
    // ----------------------------------------------------
    const agent = this.resolveAgent(targetAgentType);
    db.updateAgentRun(tenantId, runId, { current_step: "PLAN", prompt_version: PromptRegistry.getTemplate(agent.agentType).version });

    // ----------------------------------------------------
    // STEP 4: RETRIEVE KNOWLEDGE (RAG)
    // ----------------------------------------------------
    db.updateAgentRun(tenantId, runId, { current_step: "RETRIEVE" });
    let citations: RetrievalCitation[] = [];
    const isKnowledgeQuery =
      classification.category === "RETURN" ||
      classification.category === "SHIPPING" ||
      classification.intent === "PRODUCT_INFORMATION" ||
      classification.intent === "CUSTOMER_SUPPORT";

    if (isKnowledgeQuery) {
      try {
        citations = await KnowledgeService.searchKnowledge(tenantId, options.messageText, 3, 0.60);
      } catch {
        citations = [];
      }
    }

    // ----------------------------------------------------
    // STEP 5: BUILD CONTEXT
    // ----------------------------------------------------
    const agentContext = await ContextBuilder.build(context, {
      conversationId: options.conversationId,
      queryText: options.messageText,
      knowledgeCitations: citations,
      maxRecentMessages: 8,
    });

    // ----------------------------------------------------
    // STEP 6: EXECUTE MULTI-STEP AGENT REASONING & TOOLS
    // ----------------------------------------------------
    db.updateAgentRun(tenantId, runId, { current_step: "TOOL_CALL" });

    let executionResult;
    try {
      executionResult = await agent.execute(context, agentContext, options.messageText, runId, {
        toolSubset: options.isCopilot ? COPILOT_READ_ONLY_TOOLS : undefined, // "Suggest" only reads (FX-69)
      });
    } catch (err: any) {
      const latency = Date.now() - startTime;
      db.updateAgentRun(tenantId, runId, {
        status: "FAILED",
        completed_at: new Date().toISOString(),
        latency_ms: latency,
        error_code: "AI_TOOL_FAILED",
        error_message: err.message || "Agent execution failed.",
      });

      return {
        runId,
        status: "FAILED",
        intent: classification.intent,
        agentType: targetAgentType,
        finalResponse: "আপনার অনুরোধটি প্রসেস করতে সাময়িক সমস্যা হয়েছে। আমাদের সাপোর্ট টিম শীঘ্রই যোগাযোগ করবে।",
        toolCallsCount: 0,
        handoffRequired: true,
        handoffReason: err.message,
        isCopilotSuggestion: false,
        citations,
        tokensUsed: 0,
        costUsd: 0,
        costBdt: 0,
        latencyMs: latency,
      };
    }

    // ----------------------------------------------------
    // STEP 7: RESPONSE VALIDATION & GROUNDING CHECK
    // ----------------------------------------------------
    db.updateAgentRun(tenantId, runId, { current_step: "VERIFY" });
    let validatedResponse = executionResult.finalResponse;

    // Safety fallback if response contains forbidden secrets
    if (
      validatedResponse.includes("whsec_") ||
      validatedResponse.includes("sk_live") ||
      validatedResponse.includes("EAAB")
    ) {
      validatedResponse = "আমাদের স্টোর সংক্রান্ত তথ্যের জন্য ধন্যবাদ। আপনাকে আর কীভাবে সহায়তা করতে পারি?";
    }

    // ----------------------------------------------------
    // STEP 8: MODE DISPATCH (COPILOT vs AUTONOMOUS)
    // ----------------------------------------------------
    db.updateAgentRun(tenantId, runId, { current_step: "SEND" });

    const isCopilot = policy.ai_mode === "AI_COPILOT" || !policy.is_enabled;
    if (isCopilot && !options.simulateOnly) {
      // Store suggestion in conversation metadata for operator review
      if (conversation) {
        db.updateConversation(tenantId, conversation.id, {
          metadata: {
            ...conversation.metadata,
            ai_copilot_suggestion: {
              run_id: runId,
              suggested_text: validatedResponse,
              intent: classification.intent,
              agent_type: targetAgentType,
              citations: citations.map((c) => ({ title: c.document_title, section: c.section })),
              generated_at: new Date().toISOString(),
            },
          },
        });
      }
    }

    // ----------------------------------------------------
    // STEP 9: COMPLETE RUN & RECORD OBSERVABILITY
    // ----------------------------------------------------
    const latency = Date.now() - startTime;
    const { costUsd, costBdt } = modelRouter.calculateCost(
      agent.modelTier,
      executionResult.promptTokens,
      executionResult.completionTokens,
      executionResult.cachedPromptTokens
    );

    const runStatus = executionResult.handoffRequired ? "ESCALATED" : "COMPLETED";

    db.updateAgentRun(tenantId, runId, {
      status: runStatus,
      completed_at: new Date().toISOString(),
      latency_ms: latency,
      input_tokens: executionResult.promptTokens,
      output_tokens: executionResult.completionTokens,
      estimated_cost_usd: costUsd,
      estimated_cost_bdt: costBdt,
      tool_calls_count: executionResult.toolCallsCount,
      final_response: validatedResponse,
      model: executionResult.model,
    });

    // Record AI usage
    db.recordAIUsage({
      id: `usg_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      agent_run_id: runId,
      conversation_id: options.conversationId,
      agent_type: targetAgentType,
      model: executionResult.model,
      provider: "CommerceOS-LLM",
      prompt_tokens: executionResult.promptTokens,
      completion_tokens: executionResult.completionTokens,
      total_tokens: executionResult.promptTokens + executionResult.completionTokens,
      cached_tokens: executionResult.cachedPromptTokens,
      estimated_cost_usd: costUsd,
      estimated_cost_bdt: costBdt,
      currency: "BDT",
      timestamp: new Date().toISOString(),
    });

    // Update conversation multi-turn summary in background if conversation is active (not for a copilot suggestion,
    // which writes nothing to the conversation: FX-69)
    if (!options.isCopilot) {
      MemoryService.updateConversationSummary(
        tenantId,
        options.conversationId,
        classification.intent
      ).catch(() => {});
    }

    return {
      runId,
      status: runStatus,
      intent: classification.intent,
      agentType: targetAgentType,
      finalResponse: validatedResponse,
      toolCallsCount: executionResult.toolCallsCount,
      handoffRequired: executionResult.handoffRequired,
      handoffReason: executionResult.handoffReason,
      isCopilotSuggestion: isCopilot,
      citations,
      tokensUsed: executionResult.promptTokens + executionResult.completionTokens,
      costUsd,
      costBdt,
      latencyMs: latency,
    };
  }

  public static async simulate(input: AgentSimulationInput): Promise<AgentRunOutput> {
    const conversationId = input.conversationId || `sim_cnv_${Date.now()}_${randomSuffix()}`;
    return this.run(input.context, {
      conversationId,
      messageText: input.messageText,
      simulateOnly: true,
      forcedAgent: input.agentId,
    });
  }

  private static resolveAgent(agentType: AgentType) {
    switch (agentType) {
      case "SALES":
        return this.salesAgent;
      case "ORDER_ASSISTANT":
        return this.orderAgent;
      case "PRODUCT_INFO":
        return this.productAgent;
      case "CUSTOMER_SUPPORT":
      default:
        return this.supportAgent;
    }
  }
}
