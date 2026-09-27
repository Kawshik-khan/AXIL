/**
 * CommerceOS Phase 6: Decision Engine & Phase 5 Workflow Bridge
 * Evaluates recommendation policy, manages human approval gates, and dispatches durable DAG workflows.
 */

import { db } from "@/infrastructure/db";
import { DecisionRequest, Recommendation } from "@/types/intelligence";
import { ActionRiskLevel, ApprovalStatus } from "@/types/orchestration";
import { autonomyPolicyService } from "@/domains/ai/orchestration/autonomy/autonomy-policy.service";
import { workflowEngine } from "@/domains/ai/orchestration/engine/workflow-engine";

export class DecisionService {
  /**
   * Converts a recommendation into an evaluated decision request
   */
  public async evaluateAndProposeDecision(
    tenantId: string,
    recommendationId: string,
    context: Record<string, unknown> = {}
  ): Promise<DecisionRequest> {
    const rec = db.getRecommendationById(recommendationId);
    if (!rec) {
      throw new Error(`Recommendation not found: ${recommendationId}`);
    }

    // 1. Policy & Autonomy Risk Evaluation via Phase 5 Autonomy Policy
    const riskLevel: ActionRiskLevel = rec.action_risk_level || ActionRiskLevel.HIGH;
    const requiresApproval = autonomyPolicyService.requiresApproval(
      tenantId,
      "SUPERVISOR",
      riskLevel
    );

    const decisionId = `dec_${Date.now()}_${tenantId}`;

    // 2. Build candidate actions
    const candidateActions = [
      {
        name: rec.title,
        agent_type: rec.type === "REORDER_STOCK" ? "INVENTORY" : "SALES",
        action_type: rec.type,
        payload: { recommendation_id: rec.id, ...context },
        risk_level: riskLevel,
      },
    ];

    let approvalId: string | undefined = undefined;
    let status: DecisionRequest["status"] = "EVALUATING";

    if (requiresApproval) {
      // Create Phase 5 Approval Request
      const approvalReq = db.insertApprovalRequest({
        id: `appr_dec_${Date.now()}_${tenantId}`,
        tenant_id: tenantId,
        workflow_id: `wf_pending_${decisionId}`,
        task_id: `task_dec_${decisionId}`,
        requested_by_agent: "SUPERVISOR",
        action: rec.type,
        risk_level: riskLevel,
        target_entity_type: (rec.type === "REORDER_STOCK"
          ? "INVENTORY"
          : rec.type === "VIP_CUSTOMER_OUTREACH"
          ? "CUSTOMER"
          : "ORDER") as any,
        target_entity_id: rec.affected_entities[0]?.id || rec.id,
        entity_state_snapshot: { status: rec.status },
        payload: { recommendation_id: rec.id, decision_id: decisionId },
        reason: rec.rationale,
        status: ApprovalStatus.PENDING,
        expires_at: rec.expires_at,
        created_at: new Date().toISOString(),
      });

      approvalId = approvalReq.id;
      status = "PENDING_APPROVAL";

      // Mark recommendation under review
      db.updateRecommendation(rec.id, { status: "REVIEWING" });
    } else {
      // Autonomous execution allowed by Level 4 policy!
      status = "EXECUTING";
    }

    const decision: DecisionRequest = {
      id: decisionId,
      tenant_id: tenantId,
      recommendation_id: rec.id,
      objective: rec.title,
      context,
      evidence: rec.evidence,
      constraints: rec.assumptions,
      candidate_actions: candidateActions,
      policy_evaluation: {
        allowed: true,
        requires_approval: requiresApproval,
        risk_level: riskLevel,
        reason: requiresApproval
          ? `Policy requires operator sign-off for ${riskLevel} risk actions.`
          : `Autonomous execution permitted under active policy level.`,
      },
      approval_id: approvalId,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.insertDecisionRequest(decision);

    // If autonomous, immediately trigger Phase 5 workflow
    if (!requiresApproval) {
      await this.executeDecisionWorkflow(decision, rec);
    }

    return decision;
  }

  /**
   * Human operator approves the decision request
   */
  public async approveDecision(
    decisionId: string,
    operatorName: string
  ): Promise<{ decision: DecisionRequest; workflowId: string }> {
    const dec = db.getDecisionRequestById(decisionId);
    if (!dec) throw new Error(`DecisionRequest not found: ${decisionId}`);

    if (dec.status !== "PENDING_APPROVAL" && dec.status !== "EVALUATING") {
      throw new Error(`Decision cannot be approved in status: ${dec.status}`);
    }

    const rec = dec.recommendation_id ? db.getRecommendationById(dec.recommendation_id) : undefined;

    // Resolve approval request if present
    if (dec.approval_id) {
      db.updateApprovalRequest(dec.approval_id, {
        status: ApprovalStatus.APPROVED,
        approved_by: operatorName,
        approved_at: new Date().toISOString(),
      });
    }

    // Execute through Phase 5 Workflow Engine
    const wf = await this.executeDecisionWorkflow(dec, rec);

    const updated = db.updateDecisionRequest(dec.id, {
      status: "EXECUTING",
      workflow_id: wf.id,
    });

    if (rec) {
      db.updateRecommendation(rec.id, {
        status: "APPROVED",
        reviewed_by: operatorName,
        reviewed_at: new Date().toISOString(),
        dispatched_workflow_id: wf.id,
      });
    }

    return { decision: updated, workflowId: wf.id };
  }

  /**
   * Human operator rejects the decision request
   */
  public async rejectDecision(
    decisionId: string,
    operatorName: string,
    reason: string
  ): Promise<DecisionRequest> {
    const dec = db.getDecisionRequestById(decisionId);
    if (!dec) throw new Error(`DecisionRequest not found: ${decisionId}`);

    if (dec.approval_id) {
      db.updateApprovalRequest(dec.approval_id, {
        status: ApprovalStatus.REJECTED,
        rejected_by: operatorName,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
      });
    }

    const updated = db.updateDecisionRequest(dec.id, {
      status: "REJECTED",
    });

    if (dec.recommendation_id) {
      db.updateRecommendation(dec.recommendation_id, {
        status: "REJECTED",
        reviewed_by: operatorName,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      });
    }

    return updated;
  }

  private async executeDecisionWorkflow(decision: DecisionRequest, rec?: Recommendation): Promise<any> {
    const workflow = await workflowEngine.createWorkflow({
      tenantId: decision.tenant_id,
      name: decision.objective,
      description: `Autonomous execution for decision: ${decision.id}`,
      objective: rec?.description || decision.objective,
      triggerType: "MANUAL" as any,
      createdByType: "SYSTEM",
      contextEntities: {
        decision_id: decision.id,
        recommendation_id: decision.recommendation_id,
      },
    });

    // Start execution loop
    await workflowEngine.startWorkflow(workflow.id);

    return workflow;
  }
}

export const decisionService = new DecisionService();
