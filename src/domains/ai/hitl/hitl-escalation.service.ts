/**
 * CommerceOS Phase 4: Human-in-the-Loop (HITL) Escalation Service
 * Manages operator triage queues, SLA tracking, automated bot pausing,
 * and escalation resolution for conversational commerce.
 */

import { db } from "@/infrastructure/db";
import { AiBudgetGuard } from "@/domains/ai/safety/budget-guard";
import { AppError, NotFoundError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import type {
  AgentHitlEscalationRecord,
  EscalationPriority,
  EscalationStatus,
} from "@/types/ai";
import { ModelRouter } from "../providers/model-router";
import { ConversationControlService, type ControlActor } from "@/domains/social/conversations/conversation-control.service";

const SLA_MINUTES: Record<EscalationPriority, number> = {
  URGENT: 5,
  HIGH: 15,
  NORMAL: 60,
  LOW: 240,
};

function calcP95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}


export interface CreateEscalationInput {
  tenantId: string;
  conversationId: string;
  traceId?: string;
  triggerReason: string;
  priority?: EscalationPriority;
  customerId?: string;
  customerPhone?: string;
  orderDraft?: AgentHitlEscalationRecord["order_draft"];
  /** Who escalates (ADR-121): the agent turn when the runtime raises it; `system:hitl` otherwise. */
  actor?: ControlActor;
}

export interface ResolveEscalationInput {
  escalationId: string;
  resolutionType: "HUMAN_REPLIED" | "DRAFT_APPROVED" | "DRAFT_REJECTED" | "BOT_RESUMED";
  resumeBot?: boolean;
  notes?: string;
  userId?: string;
  /** A CommerceOS operator (platform takeover) rather than a member of the workspace (ADR-121 audit). */
  platformOperator?: boolean;
}

export class HitlEscalationService {
  /**
   * Calculates SLA due date from priority.
   */
  public static calculateSlaDue(priority: EscalationPriority, from = Date.now()): string {
    const minutes = SLA_MINUTES[priority] || 60;
    return new Date(from + minutes * 60_000).toISOString();
  }

  /**
   * Masks a customer phone number for privacy preservation.
   */
  public static maskPhone(phone?: string): string {
    if (!phone) return "Anonymous";
    const cleaned = phone.replace(/\s+/g, "");
    if (cleaned.length < 8) return cleaned;
    return cleaned.slice(0, 5) + "****" + cleaned.slice(-4);
  }

  /**
   * Creates an escalation ticket and automatically pauses the AI bot on the conversation.
   */
  public static createEscalation(input: CreateEscalationInput): AgentHitlEscalationRecord {
    // Callers pass the tenant from the request context (escalate route) or the agent principal (runtime), never a body
    const { tenantId, conversationId } = input;
    const priority = input.priority || "NORMAL";
    const now = new Date().toISOString();
    const id = `hitl_${Date.now()}_${randomSuffix()}`;

    // Atomically pause bot on conversation (ADR-121: a person who already has it keeps it)
    const conversation = db.findConversationById(tenantId, conversationId);
    if (conversation) {
      ConversationControlService.transition(tenantId, conversationId, "ESCALATED", input.actor ?? "system:hitl", "hitl_escalation");
    }

    const escalation: AgentHitlEscalationRecord = {
      id,
      tenant_id: tenantId,
      conversation_id: conversationId,
      trace_id: input.traceId || `trc_direct_${randomSuffix()}`,
      customer_id: input.customerId,
      customer_phone_masked: this.maskPhone(input.customerPhone),
      priority,
      status: "PENDING_REVIEW",
      trigger_reason: input.triggerReason,
      order_draft: input.orderDraft,
      sla_due_at: this.calculateSlaDue(priority),
      created_at: now,
      updated_at: now,
    };

    return db.saveAgentHitlEscalation(escalation);
  }

  /**
   * Claims an escalation ticket by a merchant staff operator.
   */
  public static claimEscalation(
    tenantId: string,
    escalationId: string,
    userId: string,
    opts: { platformOperator?: boolean } = {}
  ): AgentHitlEscalationRecord {
    const escalation = db.findAgentHitlEscalation(tenantId, escalationId);
    if (!escalation) {
      throw new NotFoundError("Escalation ticket not found");
    }
    const pending = escalation.status === "PENDING_REVIEW";

    const updated: AgentHitlEscalationRecord = {
      ...escalation,
      status: "CLAIMED",
      assigned_to_user_id: userId,
      assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // The person who claimed a pending ticket now has the chat. An old (claimed or resolved) ticket never takes a live
    // chat back from the agent. A platform operator is audited as one and never recorded as the chat's owner.
    if (pending && db.findConversationById(tenantId, escalation.conversation_id)) {
      ConversationControlService.transition(
        tenantId,
        escalation.conversation_id,
        "HUMAN",
        opts.platformOperator ? `platform:${userId}` : `user:${userId}`,
        "hitl_claim",
        { ownerUserId: userId }
      );
    }

    return db.saveAgentHitlEscalation(updated);
  }

  /**
   * Resolves an active escalation ticket.
   */
  public static resolveEscalation(tenantId: string, input: ResolveEscalationInput): AgentHitlEscalationRecord {
    const escalation = db.findAgentHitlEscalation(tenantId, input.escalationId);
    if (!escalation) {
      throw new NotFoundError("Escalation ticket not found");
    }

    const now = new Date().toISOString();
    const updated: AgentHitlEscalationRecord = {
      ...escalation,
      status: "RESOLVED",
      resolution_type: input.resolutionType,
      resolution_notes: input.notes,
      resolved_at: now,
      updated_at: now,
      assigned_to_user_id: input.userId || escalation.assigned_to_user_id,
    };

    // If staff requests bot resume, unpause conversation (ADR-121: and answer what waited, like any resume)
    if (input.resumeBot) {
      const convo = db.findConversationById(tenantId, escalation.conversation_id);
      if (convo) {
        ConversationControlService.transition(
          tenantId,
          escalation.conversation_id,
          "BOT",
          !input.userId ? "system:hitl" : input.platformOperator ? `platform:${input.userId}` : `user:${input.userId}`,
          "hitl_resolved"
        );
      }
    }

    return db.saveAgentHitlEscalation(updated);
  }

  /**
   * Retrieves active escalations for a tenant queue.
   */
  public static getQueue(
    tenantId: string,
    filter?: { status?: EscalationStatus; priority?: EscalationPriority }
  ): AgentHitlEscalationRecord[] {
    let list = db.getAgentHitlEscalations(tenantId, filter?.status);
    if (filter?.priority) {
      list = list.filter((e) => e.priority === filter.priority);
    }
    return list;
  }

  /**
   * Aggregates platform-wide AI Observability radar telemetry for Super Admin Pillar 4.
   */
  public static getPlatformRadar(): {
    total_turns_24h: number;
    hallucinations_blocked_24h: number;
    prompt_injections_blocked_24h: number;
    active_hitl_escalations: number;
    /** null until an escalation has been resolved */
    avg_human_response_time_min: number | null;
    tenant_budget_alerts: Array<{
      tenant_id: string;
      spend_usd: number;
      cap_usd: number;
      usage_pct: number;
    }>;
    tenant_budgets: Array<{
      tenant_id: string;
      tenant_name: string;
      spend_usd: number;
      cap_usd: number;
      usage_pct: number;
      hard_cap_action: string;
      is_near_limit: boolean;
      is_hard_cap_exceeded: boolean;
    }>;
    /** The router's configured models with traffic measured from traces; no health is claimed without data. */
    ai_mode: string;
    model_gateway_health: Array<{
      name: string;
      tier: string;
      provider: string;
      status: "ACTIVE" | "IDLE";
      p95_latency_ms: number | null;
      requests_24h: number;
    }>;
    /** null without traces in the last 24 hours */
    provider_latency_p95_ms: number | null;
  } {
    const allTraces = db.getAllAgentExecutionTraces();
    const allEscalations = db.getAllAgentHitlEscalations();
    const allSettings = db.getAllTenantAiGuardSettings();
    const allTenants = db.getTenants();

    // 24h filter
    const cutoff = Date.now() - 24 * 60 * 60_000;
    const recentTraces = allTraces.filter((t) => Date.parse(t.timestamp) >= cutoff);

    let hallucinations = 0;
    let injections = 0;
    const latencies: number[] = [];

    // Per-model trace metrics
    const modelStats = new Map<string, { latencies: number[]; count: number }>();

    for (const trace of recentTraces) {
      latencies.push(trace.latency_ms || 0);

      const m = trace.model_id || "default";
      if (!modelStats.has(m)) modelStats.set(m, { latencies: [], count: 0 });
      const entry = modelStats.get(m)!;
      entry.count++;
      if (trace.latency_ms) entry.latencies.push(trace.latency_ms);

      if (
        trace.guardrails_triggered.includes("UNGROUNDED_PRICE_DETECTED") ||
        trace.guardrails_triggered.includes("UNVERIFIED_ORDER_CLAIM")
      ) {
        hallucinations++;
      }
      if (trace.guardrails_triggered.includes("PROMPT_INJECTION_DETECTED")) {
        injections++;
      }
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies.length > 0 ? latencies[Math.min(p95Index, latencies.length - 1)] : null;

    const activeEscalations = allEscalations.filter((e) => e.status === "PENDING_REVIEW" || e.status === "CLAIMED").length;

    // SLA response time calculation
    const resolved = allEscalations.filter((e) => e.status === "RESOLVED" && e.resolved_at);
    let totalMinutes = 0;
    for (const r of resolved) {
      const dur = (Date.parse(r.resolved_at!) - Date.parse(r.created_at)) / 60_000;
      if (dur > 0) totalMinutes += dur;
    }
    const avgResponseTime = resolved.length > 0 ? Number((totalMinutes / resolved.length).toFixed(1)) : null;

    // Full tenant budgets list (all workspaces & guard settings)
    const settingsMap = new Map(allSettings.map((s) => [s.tenant_id, s]));
    const tenantMap = new Map(allTenants.map((t: { id: string; name: string }) => [t.id, t.name]));
    const allTenantIds = Array.from(new Set([...allTenants.map((t: { id: string }) => t.id), ...allSettings.map((s) => s.tenant_id)]));

    const tenantBudgets = allTenantIds.map((tenantId) => {
      const s = settingsMap.get(tenantId);
      const name = tenantMap.get(tenantId) || tenantId;
      const spend = s ? Number(s.current_month_spend_usd.toFixed(2)) : 0;
      // Without stored settings, the guard's own default applies (the value it enforces)
      const cap = Number((s ? s.monthly_budget_usd : AiBudgetGuard.getSettings(tenantId).monthly_budget_usd).toFixed(2));
      const usage_pct = cap > 0 ? Number(((spend / cap) * 100).toFixed(1)) : 0;
      const softCap = s?.soft_cap_percent ?? 80;
      const hardCap = s?.hard_cap_percent ?? 100;
      return {
        tenant_id: tenantId,
        tenant_name: name,
        spend_usd: spend,
        cap_usd: cap,
        usage_pct,
        hard_cap_action: (s as any)?.hard_cap_action || "FALLBACK_TO_RULES",
        is_near_limit: usage_pct >= softCap,
        is_hard_cap_exceeded: usage_pct >= hardCap,
      };
    });

    // Tenant budget alerts (> 80% usage)
    const budgetAlerts = allSettings
      .filter((s) => s.monthly_budget_usd > 0)
      .map((s) => ({
        tenant_id: s.tenant_id,
        spend_usd: s.current_month_spend_usd,
        cap_usd: s.monthly_budget_usd,
        usage_pct: Number(((s.current_month_spend_usd / s.monthly_budget_usd) * 100).toFixed(1)),
      }))
      .filter((a) => a.usage_pct >= 80);



    // Configured models from the router, with requests and p95 measured from this window's traces
    const routerStatus = ModelRouter.getInstance().getStatus();
    const modelRow = (tier: string, name: string | null, provider: string | null) => {
      if (!name) return null;
      const stats = modelStats.get(name);
      const count = stats ? stats.count : 0;
      return {
        name,
        tier,
        provider: provider ?? routerStatus.provider,
        status: (count > 0 ? "ACTIVE" : "IDLE") as "ACTIVE" | "IDLE",
        p95_latency_ms: stats && stats.latencies.length > 0 ? calcP95(stats.latencies) : null,
        requests_24h: count,
      };
    };
    const modelGatewayHealth = [
      modelRow("TIER_1_FAST", routerStatus.models.TIER_1_FAST || null, routerStatus.provider),
      modelRow("TIER_2_REASONING", routerStatus.models.TIER_2_REASONING || null, routerStatus.provider),
      modelRow("TIER_3_EMBEDDING", routerStatus.models.TIER_3_EMBEDDING || null, routerStatus.embedding_provider),
    ].filter((r): r is NonNullable<typeof r> => r !== null);

    return {
      total_turns_24h: recentTraces.length,
      hallucinations_blocked_24h: hallucinations,
      prompt_injections_blocked_24h: injections,
      active_hitl_escalations: activeEscalations,
      avg_human_response_time_min: avgResponseTime,
      tenant_budget_alerts: budgetAlerts,
      tenant_budgets: tenantBudgets,
      ai_mode: routerStatus.mode,
      model_gateway_health: modelGatewayHealth,
      provider_latency_p95_ms: p95Latency,
    };
  }
}

