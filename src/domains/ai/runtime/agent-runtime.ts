import { agentPaused } from "@/domains/social/conversations/conversation-control.state";
import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 4: Agent Runtime & State Machine
 * Deterministic 9-step agent lifecycle with strict grounding, safety, and budget enforcement.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import {
  AgentRun,
  AIErrorCode,
  AgentType,
  RetrievalCitation,
  ClassifiedIntent,
} from "@/types/ai";
import { AgentRouter } from "../router/agent-router";
import { ContextBuilder } from "../context/context-builder";
import { KnowledgeService } from "../rag/knowledge.service";
import { MemoryService } from "../memory/memory.service";
import { modelRouter } from "../providers/model-router";
import { PromptRegistry } from "../prompts/prompt-registry";
import { AgentPolicyService } from "../policy/agent-policy.service";
import { PlatformEntitlementService } from "@/domains/platform/services/platform-entitlement.service";
import { isAppError } from "@/lib/errors";
import { assertNotKilled } from "@/lib/safety-gate";

// Specialized Agents
import { CustomerSupportAgent } from "../agents/customer-support.agent";
import { SalesAgent } from "../agents/sales.agent";
import { OrderAssistantAgent } from "../agents/order-assistant.agent";
import { ProductInfoAgent } from "../agents/product-info.agent";

// Safety & Tools
import { RequestHumanHandoffTool } from "../tools/implementations/human-tools";
import { toolRegistry } from "../tools/tool-registry";
import { OutboundCancelledError } from "@/lib/outbound-http";
import type { PreloadedToolEvidence } from "../agents/base-agent";

function toLatinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
}

function inventoryArguments(message: string): Record<string, unknown> {
  const normalized = toLatinDigits(message.toLowerCase());
  const size = normalized.match(/(?:size|সাইজ)\s*(?:e|ে|is)?\s*([0-9]{1,3}|xs|s|m|l|xl|xxl)/i)?.[1]
    || normalized.match(/([0-9]{1,3})\s*(?:size|সাইজ)/i)?.[1];
  const stopWords = new Set([
    "bhai", "vai", "please", "ache", "ase", "available", "stock", "e", "ki", "the", "this", "that",
    "is", "in", "size", "sizee", "color", "colour", "gotri", "আছে", "আসবে", "ভাই", "এই", "ওই", "টা",
    "টি", "সাইজ", "সাইজে", "কালার", "রং", "কি", "হবে", "পাব", "পাওয়া", "যাবে",
  ]);
  const productQuery = normalized
    .replace(/[০-৯]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/(টা|টি|গুলো|গুলি)$/u, ""))
    .filter((word) => word && !stopWords.has(word) && !/^\d+$/.test(word))
    .join(" ")
    .trim();
  return {
    ...(productQuery ? { product_query: productQuery } : { product_query: normalized }),
    ...(size ? { variant_attributes: { size: size.toUpperCase() } } : {}),
  };
}

function requiredEvidencePlan(intent: string, message: string): Array<{ toolName: string; arguments: Record<string, unknown> }> {
  if (intent === "PRODUCT_AVAILABILITY" || intent === "PRODUCT_PRICE") {
    const invArgs = inventoryArguments(message);
    const productQuery = (invArgs.product_query as string) || message.trim();
    const inventoryLookup = { toolName: "check_inventory", arguments: invArgs };
    if (intent === "PRODUCT_PRICE" || /price|dam|daam|koto|কত|দাম/i.test(message)) {
      return [inventoryLookup, { toolName: "search_products", arguments: { query: productQuery, limit: 5 } }];
    }
    return [inventoryLookup];
  }
  if (intent === "RETURN_POLICY") {
    return [{ toolName: "search_knowledge", arguments: { query: message, top_k: 3 } }];
  }
  if (intent === "PRODUCT_INFORMATION" && /size|measurement|chest|সাইজ|মাপ/i.test(message)) {
    return [{ toolName: "search_knowledge", arguments: { query: message, top_k: 3 } }];
  }
  if (intent === "SHIPPING_COST") {
    const lower = message.toLowerCase();
    const outsideDhaka = /outside\s+dhaka|ঢাকার\s*(বাহিরে|বাইরে)|ঢাকার\s*বাইর/.test(lower);
    const insideDhaka = /inside\s+dhaka|within\s+dhaka|ঢাকার\s*ভিতরে|ঢাকার\s*মধ্যে/.test(lower);
    if (outsideDhaka || insideDhaka) {
      return [{ toolName: "search_knowledge", arguments: { query: message, top_k: 3 } }, {
        toolName: "get_shipping_estimate",
        arguments: { delivery_zone: outsideDhaka ? "OUTSIDE_DHAKA" : "INSIDE_DHAKA" },
      }];
    }
  }
  return [];
}

export interface AgentRunOptions {
  conversationId: string;
  messageText: string;
  simulateOnly?: boolean; // When true, does not send external social messages
  forcedAgent?: AgentType;
  isCopilot?: boolean; // When true, represents human operator assist in inbox
  /** Reuse an already evaluated route so callers do not classify the same message twice. */
  classificationOverride?: ClassifiedIntent;
  signal?: AbortSignal;
}

export interface AgentSimulationInput {
  context: RequestContext;
  messageText: string;
  channelType?: string;
  customerId?: string;
  customerName?: string;
  agentId?: AgentType;
  conversationId?: string;
  signal?: AbortSignal;
}

export interface AgentRunOutput {
  runId: string;
  status: "COMPLETED" | "ESCALATED" | "FAILED" | "BLOCKED" | "CANCELLED";
  intent: string;
  agentType: AgentType;
  finalResponse: string;
  toolCallsCount: number;
  handoffRequired: boolean;
  handoffReason?: string;
  /** Safe, non-sensitive diagnostic identifier for failed live executions. */
  failureCode?: AIErrorCode;
  isCopilotSuggestion: boolean;
  confidence?: number;
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
    assertNotKilled(tenantId);
    const policy = db.getAIPolicy(tenantId);

    const runId = `run_${Date.now()}_${randomSuffix()}`;

    // ----------------------------------------------------
    // STEP 1: RECEIVE & POLICY PRE-CHECK
    // ----------------------------------------------------
    const conversation = db.findConversationById(tenantId, options.conversationId);

    // Human takeover constraint: if conversation is in HUMAN mode or automation is paused, STOP (unless running as human Copilot assist)
    if (!options.isCopilot && conversation && agentPaused(conversation)) {
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

    if (!(await PlatformEntitlementService.can(tenantId, "ai_monthly_runs"))) {
      return {
        runId,
        status: "BLOCKED",
        intent: "AI_RUN_LIMIT_REACHED",
        agentType: options.forcedAgent || "SUPERVISOR",
        finalResponse: "The AI run limit for this workspace has been reached. Please try again later or contact an administrator.",
        toolCallsCount: 0,
        handoffRequired: false,
        handoffReason: "AI_MONTHLY_RUN_LIMIT_REACHED",
        isCopilotSuggestion: false,
        citations: [],
        tokensUsed: 0,
        costUsd: 0,
        costBdt: 0,
        latencyMs: Date.now() - startTime,
      };
    }

    const budgetReservation = await AgentPolicyService.reserveRunBudget(tenantId, runId, options.conversationId);
    if (!budgetReservation.reserved) {
      return {
        runId,
        status: "BLOCKED",
        intent: "AI_BUDGET_EXCEEDED",
        agentType: options.forcedAgent || "SUPERVISOR",
        finalResponse: "The AI usage budget for this workspace has been reached. Please contact an administrator.",
        toolCallsCount: 0,
        handoffRequired: false,
        handoffReason: budgetReservation.reason,
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
      prompt_version: "router-v1",
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

    const classification = options.classificationOverride || await AgentRouter.route(
      context,
      options.conversationId,
      options.messageText,
      { isCopilot: options.isCopilot }
    );

    const targetAgentType = options.forcedAgent || classification.target_agent;
    const promptVersion = PromptRegistry.getPromptVersion(targetAgentType);
    db.updateAgentRun(tenantId, runId, {
      agent_type: targetAgentType,
      prompt_version: promptVersion,
      metadata: { classification, prompt_hash: PromptRegistry.getPromptHash(targetAgentType) },
    });

    // Deterministic, low-risk conversational fast paths should not be re-decided by a
    // probabilistic provider after the router has already classified them.
    if (classification.routing_strategy === "DETERMINISTIC_RULE" && !classification.requires_human) {
      const fastResponse = classification.intent === "GREETING"
        ? `আসসালামু আলাইকুম! ${context.tenant.name}–এ স্বাগতম। কীভাবে সাহায্য করতে পারি?`
        : classification.intent === "THANKS"
          ? "আপনাকে স্বাগতম! আর কিছু জানতে চাইলে বলুন।"
          : classification.intent === "UNKNOWN"
            ? "আমি স্টোরের পণ্য, অর্ডার ও নীতিমালা সংক্রান্ত বিষয়ে সাহায্য করতে পারি।"
            : undefined;
      if (fastResponse) {
        AgentPolicyService.releaseRunBudget(tenantId, runId);
        const latency = Date.now() - startTime;
        db.updateAgentRun(tenantId, runId, {
          status: "COMPLETED",
          current_step: "SEND",
          completed_at: new Date().toISOString(),
          latency_ms: latency,
          final_response: fastResponse,
          model: "deterministic-router-v1",
        });
        return {
          runId,
          status: "COMPLETED",
          intent: classification.intent,
          agentType: targetAgentType,
          finalResponse: fastResponse,
          toolCallsCount: 0,
          handoffRequired: false,
          isCopilotSuggestion: false,
          citations: [],
          tokensUsed: 0,
          costUsd: 0,
          costBdt: 0,
          latencyMs: latency,
        };
      }
    }

    // Check if classification requires immediate human handoff
    const isConversational = classification.intent === "GREETING" || classification.intent === "THANKS" || classification.intent === "PRODUCT_AVAILABILITY" || classification.intent === "PRODUCT_PRICE";
    const lowConfidenceHandoff = !isConversational && classification.confidence < policy.confidence_threshold_low && policy.human_handoff_reasons?.includes("LOW_CONFIDENCE");
    if (classification.requires_human || lowConfidenceHandoff) {
      AgentPolicyService.releaseRunBudget(tenantId, runId);
      if (!options.simulateOnly && !options.isCopilot) {
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
    const configured = modelRouter.getStatus();
    db.updateAgentRun(tenantId, runId, {
      metadata: {
        classification,
        prompt_hash: PromptRegistry.getPromptHash(targetAgentType),
        model_configuration: {
          mode: configured.mode,
          provider: configured.provider,
          model: configured.models[agent.modelTier],
        },
        context_hash: agentContext.context_manifest.content_hash,
        context_manifest: {
          budget_tokens: agentContext.context_manifest.budget_tokens,
          estimated_tokens: agentContext.context_manifest.estimated_tokens,
          selected_items: agentContext.context_manifest.selected_items,
          omitted_items: agentContext.context_manifest.omitted_items,
        },
      },
    });

    const orderNumbers = classification.extracted_entities?.order_numbers || [];
    if (classification.intent === "ORDER_STATUS" && orderNumbers.length === 0 && (agentContext.recent_orders?.length || 0) === 0) {
      AgentPolicyService.releaseRunBudget(tenantId, runId);
      const response = "অর্ডারের অবস্থা খুঁজে দিতে অর্ডার নম্বরটি পাঠাবেন?";
      const latency = Date.now() - startTime;
      db.updateAgentRun(tenantId, runId, {
        status: "COMPLETED",
        current_step: "SEND",
        completed_at: new Date().toISOString(),
        latency_ms: latency,
        final_response: response,
        model: "deterministic-clarification-v1",
      });
      return {
        runId,
        status: "COMPLETED",
        intent: classification.intent,
        agentType: targetAgentType,
        finalResponse: response,
        toolCallsCount: 0,
        handoffRequired: false,
        isCopilotSuggestion: false,
        confidence: classification.confidence,
        citations: [],
        tokensUsed: 0,
        costUsd: 0,
        costBdt: 0,
        latencyMs: latency,
      };
    }

    // ----------------------------------------------------
    // STEP 6: EXECUTE MULTI-STEP AGENT REASONING & TOOLS
    // ----------------------------------------------------
    db.updateAgentRun(tenantId, runId, { current_step: "TOOL_CALL" });

    let executionResult;
    try {
      const preloadedEvidence: PreloadedToolEvidence[] = [];
      for (const plannedTool of requiredEvidencePlan(classification.intent, options.messageText)) {
        if (!agent.allowedTools.includes(plannedTool.toolName)) continue;
        const result = await toolRegistry.executeTool(context, {
          toolName: plannedTool.toolName,
          arguments: plannedTool.arguments,
          agentRunId: runId,
          conversationId: options.conversationId,
          allowedTools: agent.allowedTools,
          signal: options.signal,
        });
        if (!result.success) throw new Error(`Required authoritative tool lookup failed (${plannedTool.toolName}): ${result.error} (args: ${JSON.stringify(plannedTool.arguments)})`);
        preloadedEvidence.push({ ...plannedTool, result: result.result });
      }
      const excludedTools = classification.intent === "PRODUCT_PRICE" ? ["check_inventory"] : [];
      executionResult = await agent.execute(context, agentContext, options.messageText, runId, preloadedEvidence, excludedTools, options.signal);
    } catch (err: any) {
      AgentPolicyService.releaseRunBudget(tenantId, runId);
      const latency = Date.now() - startTime;
      if (options.signal?.aborted || err instanceof OutboundCancelledError) {
        db.updateAgentRun(tenantId, runId, { status: "CANCELLED", completed_at: new Date().toISOString(), latency_ms: latency, error_code: "AI_CANCELLED", error_message: "AI_CANCELLED" });
        return { runId, status: "CANCELLED", intent: classification.intent, agentType: targetAgentType, finalResponse: "অনুরোধটি বাতিল করা হয়েছে।", toolCallsCount: 0, handoffRequired: false, isCopilotSuggestion: false, citations, tokensUsed: 0, costUsd: 0, costBdt: 0, latencyMs: latency };
      }
      const providerStatus = isAppError(err) && typeof err.details?.status === "number" ? err.details.status : undefined;
      const failureCode: AIErrorCode = isAppError(err) && (err.details?.failure_kind === "timeout" || /TIMEOUT/.test(err.code))
        ? "AI_MODEL_TIMEOUT"
        : providerStatus === 429
          ? "AI_MODEL_RATE_LIMITED"
          : isAppError(err) && err.code === "LLM_PROVIDER_ERROR" && providerStatus !== undefined
            ? "AI_MODEL_PROVIDER_ERROR"
            : isAppError(err) && ["LLM_PROVIDER_ERROR", "AI_PROVIDER_NOT_CONFIGURED", "OUTBOUND_UNREACHABLE"].includes(err.code)
              ? "AI_MODEL_UNAVAILABLE"
              : isAppError(err) && ["VALIDATION_ERROR", "BAD_REQUEST"].includes(err.code)
                ? "AI_TOOL_VALIDATION_FAILED"
                : isAppError(err) && ["FORBIDDEN", "FEATURE_NOT_ENTITLED"].includes(err.code)
                  ? "AI_POLICY_BLOCKED"
                  : "AI_TOOL_FAILED";
      db.updateAgentRun(tenantId, runId, {
        status: "FAILED",
        completed_at: new Date().toISOString(),
        latency_ms: latency,
        error_code: failureCode,
        // Do not persist arbitrary provider/tool error text; it may contain customer or credential data.
        error_message: failureCode,
      });

      return {
        runId,
        status: "FAILED",
        intent: classification.intent,
        agentType: targetAgentType,
        finalResponse: "আপনার অনুরোধটি প্রসেস করতে সাময়িক সমস্যা হয়েছে। আমাদের সাপোর্ট টিম শীঘ্রই যোগাযোগ করবে।",
        toolCallsCount: 0,
        handoffRequired: true,
        handoffReason: failureCode,
        failureCode,
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
    const { costUsd, costBdt } = modelRouter.getMode() === "LIVE"
      ? modelRouter.calculateCost(agent.modelTier, executionResult.promptTokens, executionResult.completionTokens)
      : { costUsd: 0, costBdt: 0 };

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

    // Settle the hold in-place; one run produces one usage record, including when it used no tokens.
    AgentPolicyService.settleRunBudget(tenantId, runId, options.conversationId, {
      model: executionResult.model,
      agentType: targetAgentType,
      promptTokens: executionResult.promptTokens,
      completionTokens: executionResult.completionTokens,
      costUsd,
      costBdt,
    });

    // Update conversation multi-turn summary in background if conversation is active (not for a copilot suggestion,
    // which writes nothing to the conversation: FX-69)
    if (!options.isCopilot) {
      MemoryService.updateConversationSummary(
        tenantId,
        options.conversationId,
        classification.intent
      ).catch(() => { });
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
      confidence: classification.confidence,
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
      signal: input.signal,
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
