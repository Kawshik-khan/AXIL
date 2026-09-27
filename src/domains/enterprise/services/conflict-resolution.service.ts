/**
 * CommerceOS Phase 9: Conflict Resolution Engine
 * Governed conflict detection, strategy evaluation, manual review queuing, and audit logging.
 */

import { db } from "@/infrastructure/db";
import { IntegrationConflict, ConflictStrategy } from "@/types/enterprise";

export interface ConflictEvaluationResult {
  hasConflict: boolean;
  strategyApplied: ConflictStrategy;
  resolvedData: Record<string, unknown>;
  conflictRecord?: IntegrationConflict;
}

export class ConflictResolutionService {
  /**
   * Detects and evaluates conflicts between CommerceOS state and external updates
   */
  public evaluateConflict(params: {
    organizationId: string;
    integrationId: string;
    entityType: string;
    entityId: string;
    commerceosData: Record<string, unknown>;
    externalData: Record<string, unknown>;
    conflictField: string;
    configuredStrategy: ConflictStrategy;
  }): ConflictEvaluationResult {
    const internalVal = params.commerceosData[params.conflictField];
    const externalVal = params.externalData[params.conflictField];

    // No conflict if values match
    if (internalVal === externalVal) {
      return {
        hasConflict: false,
        strategyApplied: params.configuredStrategy,
        resolvedData: { ...params.commerceosData, ...params.externalData },
      };
    }

    let finalData = { ...params.commerceosData };
    let isResolved = true;
    let decision: IntegrationConflict["resolution_decision"] = "COMMERCEOS_ACCEPTED";

    switch (params.configuredStrategy) {
      case "COMMERCEOS_WINS":
        finalData[params.conflictField] = internalVal;
        decision = "COMMERCEOS_ACCEPTED";
        break;
      case "EXTERNAL_WINS":
        finalData[params.conflictField] = externalVal;
        decision = "EXTERNAL_ACCEPTED";
        break;
      case "LATEST_VALID_UPDATE":
        finalData[params.conflictField] = externalVal;
        decision = "EXTERNAL_ACCEPTED";
        break;
      case "MANUAL_REVIEW":
        // Hold change, keep internal until human approves
        finalData[params.conflictField] = internalVal;
        isResolved = false;
        decision = undefined;
        break;
      case "FIELD_OWNERSHIP":
        // CommerceOS owns inventory & order status, external owns master product descriptions
        if (params.conflictField === "inventory_count" || params.conflictField === "order_status") {
          finalData[params.conflictField] = internalVal;
          decision = "COMMERCEOS_ACCEPTED";
        } else {
          finalData[params.conflictField] = externalVal;
          decision = "EXTERNAL_ACCEPTED";
        }
        break;
    }

    const conflict: IntegrationConflict = {
      id: `cnf_${params.entityType.toLowerCase()}_${Date.now()}`,
      organization_id: params.organizationId,
      integration_id: params.integrationId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      commerceos_value: params.commerceosData,
      external_value: params.externalData,
      conflict_field: params.conflictField,
      resolution_strategy: params.configuredStrategy,
      resolved: isResolved,
      resolution_decision: decision,
      resolved_at: isResolved ? new Date().toISOString() : undefined,
      created_at: new Date().toISOString(),
    };

    db.createIntegrationConflict(conflict);

    return {
      hasConflict: true,
      strategyApplied: params.configuredStrategy,
      resolvedData: finalData,
      conflictRecord: conflict,
    };
  }

  /**
   * Manually resolves a queued conflict
   */
  public manuallyResolve(
    conflictId: string,
    decision: "COMMERCEOS_ACCEPTED" | "EXTERNAL_ACCEPTED" | "MANUAL_MERGED",
    resolvedBy: string
  ): IntegrationConflict {
    return db.resolveIntegrationConflict(conflictId, decision, resolvedBy);
  }
}

export const conflictResolutionService = new ConflictResolutionService();
