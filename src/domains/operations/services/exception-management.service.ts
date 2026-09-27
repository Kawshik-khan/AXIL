import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 8: Central Operational Exception Engine
 * Detects, classifies, prioritizes, assigns, resolves, and verifies operational exceptions
 * across Inventory, Procurement, Pricing, Orders, Fulfillment, Shipping, Payments, and Finance.
 */

import { db } from "@/infrastructure/db";
import {
  OperationalException,
  ExceptionDomain,
  ExceptionSeverity,
  ExceptionStatus,
} from "@/types/operations";
import { AgentType } from "@/types/ai";
import { ActionRiskLevel } from "@/types/orchestration";

export class ExceptionManagementService {
  /**
   * Logs a newly detected operational exception
   */
  public createException(
    tenantId: string,
    params: {
      domain: ExceptionDomain;
      exceptionType: string;
      severity: ExceptionSeverity;
      title: string;
      description: string;
      entityType: OperationalException["entity_type"];
      entityId: string;
      evidence: Record<string, unknown>;
      rootCauseHypothesis?: string;
      proposedAction?: {
        action_type: string;
        description: string;
        risk_level: ActionRiskLevel;
        estimated_cost?: number;
        parameters: Record<string, unknown>;
      };
      assignedAgent?: AgentType;
    }
  ): OperationalException {
    const assignedAgent: AgentType =
      params.assignedAgent || this.resolveDomainAgent(params.domain);

    const exception: OperationalException = {
      id: `exp_${params.domain.toLowerCase()}_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      domain: params.domain,
      exception_type: params.exceptionType,
      severity: params.severity,
      status: "DETECTED",
      title: params.title,
      description: params.description,
      entity_type: params.entityType,
      entity_id: params.entityId,
      evidence: params.evidence,
      root_cause_hypothesis: params.rootCauseHypothesis,
      proposed_action: params.proposedAction,
      assigned_agent: assignedAgent,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createOperationalException(exception);
  }

  /**
   * Resolves an operational exception with verification evidence
   */
  public resolveException(
    tenantId: string,
    exceptionId: string,
    resolutionNotes: string,
    actor: string
  ): OperationalException {
    const exc = db.findOperationalExceptionById(tenantId, exceptionId);
    if (!exc) throw new Error(`Operational exception not found: ${exceptionId}`);

    const now = new Date().toISOString();
    const updated = db.updateOperationalException(tenantId, exceptionId, {
      status: "RESOLVED",
      resolution_notes: resolutionNotes,
      resolved_at: now,
    });

    db.createAuditLog({
      id: `aud_exp_resolve_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "OPERATIONAL_EXCEPTION_RESOLVED",
      resource_type: "operational_exception",
      resource_id: exceptionId,
      metadata: { domain: exc.domain, type: exc.exception_type, notes: resolutionNotes },
      created_at: now,
    });

    return updated;
  }

  /**
   * Escalates an exception to a human operator
   */
  public escalateException(
    tenantId: string,
    exceptionId: string,
    reason: string,
    actor: string
  ): OperationalException {
    const exc = db.findOperationalExceptionById(tenantId, exceptionId);
    if (!exc) throw new Error(`Operational exception not found: ${exceptionId}`);

    const updated = db.updateOperationalException(tenantId, exceptionId, {
      status: "ESCALATED",
      resolution_notes: `Escalated to human supervisor: ${reason}`,
    });

    db.createAuditLog({
      id: `aud_exp_escalate_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      actor_user_id: actor,
      action: "OPERATIONAL_EXCEPTION_ESCALATED",
      resource_type: "operational_exception",
      resource_id: exceptionId,
      metadata: { reason },
      created_at: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Resolves appropriate specialized agent type for domain
   */
  public resolveDomainAgent(domain: ExceptionDomain): AgentType {
    switch (domain) {
      case "INVENTORY":
        return "INVENTORY_OPERATIONS";
      case "PROCUREMENT":
        return "PROCUREMENT";
      case "PRICING":
        return "PRICING_OPERATIONS";
      case "ORDERS":
        return "ORDER_OPERATIONS";
      case "FULFILLMENT":
        return "FULFILLMENT";
      case "SHIPPING":
        return "SHIPPING_OPERATIONS";
      case "PAYMENTS":
        return "PAYMENT_OPERATIONS";
      case "FINANCE":
        return "FINANCE_OPERATIONS";
      case "SUPPORT":
        return "CUSTOMER_SUPPORT_OPERATIONS";
      case "PROVIDER":
        return "OPERATIONS_SUPERVISOR";
      default:
        return "OPERATIONS_SUPERVISOR";
    }
  }
}

export const exceptionManagementService = new ExceptionManagementService();
