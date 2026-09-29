import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 7: Campaign Management, Governance & Execution Engine
 * Handles campaign planning, risk classification, approval gating, simulation, and resilient execution.
 */

import { db } from "@/infrastructure/db";
import {
  GrowthCampaign,
  CampaignStatus,
  CampaignGoal,
  CampaignExecutionRecord,
  CampaignResult,
  CampaignSimulationSnapshot,
  MarketingChannelType,
} from "@/types/growth";
import { ActionRiskLevel, ApprovalStatus } from "@/types/orchestration";
import { ConflictError, ForbiddenError, NotFoundError, AppError } from "@/lib/errors";
import { audienceService } from "./audience.service";
import { consentService, frequencyCappingService } from "./consent.service";
import { marketingChannelService } from "./marketing-channel.service";
import { offerService } from "./offer.service";
import { assertNotKilled } from "@/lib/safety-gate";

export class CampaignService {
  /**
   * Sets the emergency kill switch. Stored (it used to live in this service's memory: lost on restart, and one server's
   * switch didn't stop another server's sends; FX-45).
   */
  public setKillSwitch(tenantId: string | null, active: boolean): void {
    db.setCampaignKillSwitch(tenantId, active);
  }

  public isKillSwitchActive(tenantId: string): boolean {
    return db.isCampaignKillSwitchActive(tenantId);
  }

  /**
   * Evaluates campaign risk tier based on audience size, budget, and discount depth
   */
  public evaluateRiskTier(params: {
    audienceSize: number;
    budgetBdt?: number;
    discountValue?: number;
    discountType?: string;
  }): { riskLevel: ActionRiskLevel; riskClass: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; requiresApproval: boolean } {
    const { audienceSize, budgetBdt = 0, discountValue = 0, discountType } = params;

    if (audienceSize > 2000 || budgetBdt > 100000 || (discountType === "PERCENTAGE" && discountValue > 30)) {
      return { riskLevel: ActionRiskLevel.CRITICAL, riskClass: "CRITICAL", requiresApproval: true };
    }
    if (audienceSize > 500 || budgetBdt > 20000 || (discountType === "PERCENTAGE" && discountValue > 15)) {
      return { riskLevel: ActionRiskLevel.HIGH, riskClass: "HIGH", requiresApproval: true };
    }
    if (audienceSize > 50 || budgetBdt > 5000) {
      return { riskLevel: ActionRiskLevel.MEDIUM, riskClass: "MEDIUM", requiresApproval: false };
    }
    return { riskLevel: ActionRiskLevel.LOW, riskClass: "LOW", requiresApproval: false };
  }

  /**
   * Creates a growth campaign draft with pre-flight risk classification
   */
  public createCampaign(params: {
    tenantId: string;
    name: string;
    objective: CampaignGoal;
    audienceId: string;
    channel: MarketingChannelType;
    variants: Array<{
      id: string;
      name: string;
      subject_or_title: string;
      content_body: string;
      call_to_action: string;
      allocation_pct: number;
    }>;
    offerId?: string;
    targetProducts?: string[];
    budgetBdt?: number;
    scheduledStartAt?: string;
    createdBy?: string;
  }): GrowthCampaign {
    const { tenantId, name, objective, audienceId, channel, variants, offerId, targetProducts, budgetBdt, scheduledStartAt, createdBy } = params;

    const audience = db.getAudienceById(tenantId, audienceId);
    if (!audience || audience.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Audience not found: ${audienceId}`, 404);
    }

    let discountVal = 0;
    let discountType = "";
    if (offerId) {
      const offer = db.getOfferById(tenantId, offerId);
      if (offer) {
        discountVal = offer.value;
        discountType = offer.type;
      }
    }

    const risk = this.evaluateRiskTier({
      audienceSize: audience.estimated_size,
      budgetBdt,
      discountValue: discountVal,
      discountType,
    });

    const campaign: GrowthCampaign = {
      id: `cmp_${Date.now()}_${randomSuffix()}`,
      tenant_id: tenantId,
      name,
      objective,
      status: "DRAFT",
      audience_id: audienceId,
      channel,
      variants,
      offer_id: offerId,
      target_products: targetProducts,
      budget_bdt: budgetBdt,
      scheduled_start_at: scheduledStartAt,
      action_risk_level: risk.riskLevel,
      required_approval: risk.requiresApproval,
      risk_class: risk.riskClass,
      created_by: createdBy || "OPERATOR",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.insertCampaign(campaign);
    return campaign;
  }

  /**
   * Edits a DRAFT campaign's content and targeting (FX-12). Status, approval and risk fields are never taken from the
   * caller: risk is re-classified from the new audience, offer and budget, so an edit can't dodge the approval gate.
   */
  public updateDraftCampaign(
    tenantId: string,
    campaignId: string,
    patch: {
      name?: string;
      objective?: CampaignGoal;
      audience_id?: string;
      channel?: MarketingChannelType;
      variants?: GrowthCampaign["variants"];
      offer_id?: string | null;
      target_products?: string[];
      budget_bdt?: number;
      scheduled_start_at?: string | null;
      scheduled_end_at?: string | null;
    }
  ): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new NotFoundError("Campaign", campaignId);
    }
    if (campaign.status !== "DRAFT") {
      throw new ConflictError(`Only DRAFT campaigns can be edited (this one is ${campaign.status}).`);
    }

    const audienceId = patch.audience_id ?? campaign.audience_id;
    const audience = db.getAudienceById(tenantId, audienceId);
    if (!audience || audience.tenant_id !== tenantId) {
      throw new NotFoundError("Audience", audienceId);
    }
    const offerId = patch.offer_id === null ? undefined : patch.offer_id ?? campaign.offer_id;
    const offer = offerId ? db.getOfferById(tenantId, offerId) : undefined;
    if (offerId && (!offer || offer.tenant_id !== tenantId)) {
      throw new NotFoundError("Offer", offerId);
    }
    const budgetBdt = patch.budget_bdt ?? campaign.budget_bdt;
    const risk = this.evaluateRiskTier({
      audienceSize: audience.estimated_size,
      budgetBdt,
      discountValue: offer?.value ?? 0,
      discountType: offer?.type ?? "",
    });

    return db.updateCampaign(tenantId, campaignId, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
      ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
      ...(patch.variants !== undefined ? { variants: patch.variants } : {}),
      ...(patch.target_products !== undefined ? { target_products: patch.target_products } : {}),
      ...(patch.scheduled_start_at !== undefined ? { scheduled_start_at: patch.scheduled_start_at ?? undefined } : {}),
      ...(patch.scheduled_end_at !== undefined ? { scheduled_end_at: patch.scheduled_end_at ?? undefined } : {}),
      audience_id: audienceId,
      offer_id: offerId,
      budget_bdt: budgetBdt,
      action_risk_level: risk.riskLevel,
      required_approval: risk.requiresApproval,
      risk_class: risk.riskClass,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Simulates expected campaign outcome and financial impact
   */
  public simulateCampaign(tenantId: string, campaignId: string): CampaignSimulationSnapshot {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    const audience = db.getAudienceById(tenantId, campaign.audience_id);
    const audienceSize = audience?.estimated_size ?? 0;

    // A what-if, labelled SIMULATED. Inputs that aren't the tenant's own data are listed as assumptions (FX-30).
    const conversionRate = campaign.channel === "WHATSAPP" ? 0.085 : campaign.channel === "FACEBOOK_MESSENGER" ? 0.055 : 0.035;
    const channelCostPerMsg = campaign.channel === "WHATSAPP" ? 1.2 : 0.2;
    const expectedOrders = Math.round(audienceSize * conversionRate);
    const recent = db.getAllOrders(tenantId).filter((o) => o.status !== "CANCELLED" && Date.parse(o.created_at) >= Date.now() - 90 * 86_400_000);
    const aov = recent.length > 0 ? recent.reduce((sum, o) => sum + o.grand_total, 0) / recent.length : null;

    const snapshot: CampaignSimulationSnapshot = {
      simulated_at: new Date().toISOString(),
      estimated_reach: audienceSize,
      expected_conversion_rate: Number((conversionRate * 100).toFixed(1)),
      expected_orders: expectedOrders,
      expected_revenue_bdt: aov === null ? null : Math.round(expectedOrders * aov),
      expected_cost_bdt: Math.round(audienceSize * channelCostPerMsg + (campaign.budget_bdt || 0)),
      expected_margin_delta_pct: null,
      assumptions: [
        `Conversion rate ${Number((conversionRate * 100).toFixed(1))}% for ${campaign.channel} is an assumption, not measured for your shop.`,
        `Message cost ৳${channelCostPerMsg} each is an assumption.`,
        aov === null
          ? "No orders in the last 90 days, so revenue isn't estimated."
          : `Average order value ৳${Math.round(aov).toLocaleString()} is your last 90 days.`,
      ],
      simulated_label: "SIMULATED",
    };

    db.updateCampaign(tenantId, campaignId, { simulation_snapshot: snapshot });
    return snapshot;
  }

  /**
   * Submits high-risk campaign for Phase 5 approval
   */
  public requestCampaignApproval(tenantId: string, campaignId: string, requestedBy: string): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    const approval = db.insertApprovalRequest({
      id: `appr_cmp_${Date.now()}_${campaignId}_${randomSuffix()}`,
      tenant_id: tenantId,
      workflow_id: `wf_${campaignId}`,
      task_id: campaignId,
      requested_by_agent: "CAMPAIGN_PLANNER",
      action: "EXECUTE_GROWTH_CAMPAIGN",
      risk_level: campaign.action_risk_level,
      target_entity_type: "CAMPAIGN",
      target_entity_id: campaignId,
      entity_state_snapshot: { status: campaign.status },
      payload: {
        campaign_name: campaign.name,
        audience_id: campaign.audience_id,
        channel: campaign.channel,
        budget_bdt: campaign.budget_bdt,
        risk_class: campaign.risk_class,
      },
      reason: `Campaign ${campaign.name} risk class is ${campaign.risk_class}, requires merchant approval`,
      status: ApprovalStatus.PENDING,
      expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    return db.updateCampaign(tenantId, campaignId, {
      status: "REVIEW",
      approval_request_id: approval.id,
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Approves a pending campaign
   */
  public approveCampaign(tenantId: string, campaignId: string, approvedBy: string): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    // Four-eyes rule (FX-10 step 4): high-risk campaigns need an approver other than their creator.
    if ((campaign.risk_class === "HIGH" || campaign.risk_class === "CRITICAL") && campaign.created_by === approvedBy) {
      throw new ForbiddenError("High-risk campaigns must be approved by someone other than their creator.");
    }

    if (campaign.approval_request_id) {
      db.updateApprovalRequest(tenantId, campaign.approval_request_id, {
        status: ApprovalStatus.APPROVED,
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      });
    }

    return db.updateCampaign(tenantId, campaignId, {
      status: "APPROVED",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Rejects a pending campaign
   */
  public rejectCampaign(tenantId: string, campaignId: string, rejectedBy: string, reason: string): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    if (campaign.approval_request_id) {
      db.updateApprovalRequest(tenantId, campaign.approval_request_id, {
        status: ApprovalStatus.REJECTED,
        rejected_by: rejectedBy,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
      });
    }

    return db.updateCampaign(tenantId, campaignId, {
      status: "CANCELLED",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Schedules a campaign
   */
  public scheduleCampaign(tenantId: string, campaignId: string, scheduledStart: string): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    if (campaign.action_risk_level === ActionRiskLevel.HIGH && campaign.status !== "APPROVED") {
      throw new Error(`High-risk campaign must be APPROVED before scheduling`);
    }

    return db.updateCampaign(tenantId, campaignId, {
      status: "SCHEDULED",
      scheduled_start_at: scheduledStart,
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Pauses an active or scheduled campaign
   */
  public pauseCampaign(tenantId: string, campaignId: string): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    return db.updateCampaign(tenantId, campaignId, {
      status: "PAUSED",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Resumes a paused campaign
   */
  public resumeCampaign(tenantId: string, campaignId: string): GrowthCampaign {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    return db.updateCampaign(tenantId, campaignId, {
      status: "RUNNING",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Executes a campaign immediately across recipient audience
   */
  public async executeCampaign(tenantId: string, campaignId: string): Promise<CampaignResult> {
    const campaign = db.getCampaignById(tenantId, campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new AppError("NOT_FOUND", `Campaign not found: ${campaignId}`, 404);
    }

    if (campaign.action_risk_level === ActionRiskLevel.HIGH && campaign.status !== "APPROVED") {
      throw new Error(`Policy violation: High-risk campaign requires human merchant approval before execution`);
    }
    assertNotKilled(tenantId, "CHANNEL", String(campaign.channel ?? "")); // FX-34: paused channel or workspace

    // Mark RUNNING
    db.updateCampaign(tenantId, campaignId, {
      status: "RUNNING",
      actual_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const snapshot = audienceService.createAudienceSnapshot(tenantId, campaign.audience_id, campaignId);
    const customerIds = snapshot.customer_ids;

    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let suppressed = 0;
    const errors: string[] = [];

    const execRecord: CampaignExecutionRecord = {
      id: `cex_${Date.now()}_${campaignId}_${randomSuffix()}`,
      tenant_id: tenantId,
      campaign_id: campaignId,
      total_recipients: customerIds.length,
      processed_count: 0,
      successful_count: 0,
      failed_count: 0,
      suppressed_count: 0,
      status: "PROCESSING",
      started_at: new Date().toISOString(),
    };
    db.insertCampaignExecution(execRecord);

    // Every customer of the tenant, indexed once: O(R + C) and no recipient silently dropped (FX-22/FX-23)
    const customersById = new Map(db.getAllCustomers(tenantId).map((c) => [c.id, c]));

    for (const custId of customerIds) {
      if (this.isKillSwitchActive(tenantId)) {
        db.updateCampaign(tenantId, campaignId, { status: "PAUSED" });
        db.updateCampaignExecution(tenantId, execRecord.id, { status: "PAUSED" });
        break;
      }

      const cust = customersById.get(custId);
      const recipientContact = campaign.channel === "EMAIL" ? cust?.email : cust?.phone;

      if (!recipientContact) {
        suppressed++;
        continue;
      }

      // Check Consent & Frequency Capping
      const eligibility = frequencyCappingService.checkSendEligibility(tenantId, custId, campaign.channel);
      if (!eligibility.eligible) {
        suppressed++;
        continue;
      }

      // Pick variant (e.g. first variant or random split)
      const custName = cust?.first_name ? `${cust.first_name} ${cust.last_name || ""}`.trim() : cust?.phone || "Customer";
      const variant = campaign.variants[0] || {
        subject_or_title: campaign.name,
        content_body: `Special update for ${custName}`,
      };

      try {
        const sendRes = await marketingChannelService.dispatchMessage({
          tenantId,
          channel: campaign.channel,
          recipientId: recipientContact,
          content: variant.content_body,
        });

        sent++;
        if (sendRes.success) {
          delivered++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Sends and failures only. Outcomes (orders, revenue, ROAS) come from recorded attributions later, never from an
    // assumed conversion rate (FX-30). They used to be 7% of delivered x ৳1,650.
    const result: CampaignResult = {
      planned_audience: customerIds.length,
      actual_audience: customerIds.length,
      messages_sent: sent,
      messages_delivered: delivered,
      messages_failed: failed,
      messages_suppressed: suppressed,
      engagements: null,
      conversions: null,
      attributed_revenue_bdt: null,
      incremental_revenue_bdt: null,
      total_cost_bdt: campaign.budget_bdt || 0,
      roas: null,
      attribution_status: "NOT_MEASURED",
      evaluated_at: new Date().toISOString(),
    };

    db.updateCampaign(tenantId, campaignId, {
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
      result_metrics: result,
    });

    db.updateCampaignExecution(tenantId, execRecord.id, {
      processed_count: customerIds.length,
      successful_count: delivered,
      failed_count: failed,
      suppressed_count: suppressed,
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
    });

    return result;
  }
}

export const campaignService = new CampaignService();
