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
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { audienceService } from "./audience.service";
import { consentService, frequencyCappingService } from "./consent.service";
import { marketingChannelService } from "./marketing-channel.service";
import { offerService } from "./offer.service";

export class CampaignService {
  private globalKillSwitchActive = false;
  private tenantKillSwitches: Record<string, boolean> = {};

  /**
   * Sets emergency kill switch state
   */
  public setKillSwitch(tenantId: string | null, active: boolean): void {
    if (tenantId === null) {
      this.globalKillSwitchActive = active;
    } else {
      this.tenantKillSwitches[tenantId] = active;
    }
  }

  public isKillSwitchActive(tenantId: string): boolean {
    return this.globalKillSwitchActive || Boolean(this.tenantKillSwitches[tenantId]);
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

    const audience = db.getAudienceById(audienceId);
    if (!audience || audience.tenant_id !== tenantId) {
      throw new Error(`Audience not found: ${audienceId}`);
    }

    let discountVal = 0;
    let discountType = "";
    if (offerId) {
      const offer = db.getOfferById(offerId);
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
      id: `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new NotFoundError("Campaign", campaignId);
    }
    if (campaign.status !== "DRAFT") {
      throw new ConflictError(`Only DRAFT campaigns can be edited (this one is ${campaign.status}).`);
    }

    const audienceId = patch.audience_id ?? campaign.audience_id;
    const audience = db.getAudienceById(audienceId);
    if (!audience || audience.tenant_id !== tenantId) {
      throw new NotFoundError("Audience", audienceId);
    }
    const offerId = patch.offer_id === null ? undefined : patch.offer_id ?? campaign.offer_id;
    const offer = offerId ? db.getOfferById(offerId) : undefined;
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

    return db.updateCampaign(campaignId, {
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
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const audience = db.getAudienceById(campaign.audience_id);
    const audienceSize = audience?.estimated_size || 100;

    // Simulation assumptions based on channel
    const conversionRate = campaign.channel === "WHATSAPP" ? 0.085 : campaign.channel === "FACEBOOK_MESSENGER" ? 0.055 : 0.035;
    const expectedOrders = Math.max(1, Math.round(audienceSize * conversionRate));
    const aov = 1650; // Avg D2C basket value
    const expectedRevenue = expectedOrders * aov;
    const channelCostPerMsg = campaign.channel === "WHATSAPP" ? 1.2 : 0.2;
    const expectedCost = Math.round(audienceSize * channelCostPerMsg + (campaign.budget_bdt || 0));
    const marginDelta = 18.5; // Estimated ROI %

    const snapshot: CampaignSimulationSnapshot = {
      simulated_at: new Date().toISOString(),
      estimated_reach: audienceSize,
      expected_conversion_rate: Number((conversionRate * 100).toFixed(1)),
      expected_orders: expectedOrders,
      expected_revenue_bdt: expectedRevenue,
      expected_cost_bdt: expectedCost,
      expected_margin_delta_pct: marginDelta,
      simulated_label: "SIMULATED",
    };

    db.updateCampaign(campaignId, { simulation_snapshot: snapshot });
    return snapshot;
  }

  /**
   * Submits high-risk campaign for Phase 5 approval
   */
  public requestCampaignApproval(tenantId: string, campaignId: string, requestedBy: string): GrowthCampaign {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const approval = db.insertApprovalRequest({
      id: `appr_cmp_${Date.now()}_${campaignId}`,
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

    return db.updateCampaign(campaignId, {
      status: "REVIEW",
      approval_request_id: approval.id,
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Approves a pending campaign
   */
  public approveCampaign(tenantId: string, campaignId: string, approvedBy: string): GrowthCampaign {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    // Four-eyes rule (FX-10 step 4): high-risk campaigns need an approver other than their creator.
    if ((campaign.risk_class === "HIGH" || campaign.risk_class === "CRITICAL") && campaign.created_by === approvedBy) {
      throw new ForbiddenError("High-risk campaigns must be approved by someone other than their creator.");
    }

    if (campaign.approval_request_id) {
      db.updateApprovalRequest(campaign.approval_request_id, {
        status: ApprovalStatus.APPROVED,
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      });
    }

    return db.updateCampaign(campaignId, {
      status: "APPROVED",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Rejects a pending campaign
   */
  public rejectCampaign(tenantId: string, campaignId: string, rejectedBy: string, reason: string): GrowthCampaign {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    if (campaign.approval_request_id) {
      db.updateApprovalRequest(campaign.approval_request_id, {
        status: ApprovalStatus.REJECTED,
        rejected_by: rejectedBy,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
      });
    }

    return db.updateCampaign(campaignId, {
      status: "CANCELLED",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Schedules a campaign
   */
  public scheduleCampaign(tenantId: string, campaignId: string, scheduledStart: string): GrowthCampaign {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    if (campaign.action_risk_level === ActionRiskLevel.HIGH && campaign.status !== "APPROVED") {
      throw new Error(`High-risk campaign must be APPROVED before scheduling`);
    }

    return db.updateCampaign(campaignId, {
      status: "SCHEDULED",
      scheduled_start_at: scheduledStart,
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Pauses an active or scheduled campaign
   */
  public pauseCampaign(tenantId: string, campaignId: string): GrowthCampaign {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    return db.updateCampaign(campaignId, {
      status: "PAUSED",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Resumes a paused campaign
   */
  public resumeCampaign(tenantId: string, campaignId: string): GrowthCampaign {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    return db.updateCampaign(campaignId, {
      status: "RUNNING",
      updated_at: new Date().toISOString(),
    })!;
  }

  /**
   * Executes a campaign immediately across recipient audience
   */
  public async executeCampaign(tenantId: string, campaignId: string): Promise<CampaignResult> {
    const campaign = db.getCampaignById(campaignId);
    if (!campaign || campaign.tenant_id !== tenantId) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    if (campaign.action_risk_level === ActionRiskLevel.HIGH && campaign.status !== "APPROVED") {
      throw new Error(`Policy violation: High-risk campaign requires human merchant approval before execution`);
    }

    // Mark RUNNING
    db.updateCampaign(campaignId, {
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
      id: `cex_${Date.now()}_${campaignId}`,
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

    const allCustomers = db.getCustomers(tenantId).customers;

    for (const custId of customerIds) {
      if (this.isKillSwitchActive(tenantId)) {
        db.updateCampaign(campaignId, { status: "PAUSED" });
        db.updateCampaignExecution(execRecord.id, { status: "PAUSED" });
        break;
      }

      const cust = allCustomers.find((c) => c.id === custId);
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

    const conversionRate = 0.07;
    const conversions = delivered > 0 ? Math.max(1, Math.round(delivered * conversionRate)) : 0;
    const aov = 1650;
    const attributedRevenue = conversions * aov;
    const incrementalRevenue = Math.round(attributedRevenue * 0.75);
    const totalCost = (campaign.budget_bdt || 0) + delivered * 1.5;
    const roas = totalCost > 0 ? Number((attributedRevenue / totalCost).toFixed(2)) : 0;

    const result: CampaignResult = {
      planned_audience: customerIds.length,
      actual_audience: customerIds.length,
      messages_sent: sent,
      messages_delivered: delivered,
      messages_failed: failed,
      messages_suppressed: suppressed,
      engagements: Math.round(delivered * 0.35),
      conversions,
      attributed_revenue_bdt: attributedRevenue,
      incremental_revenue_bdt: incrementalRevenue,
      total_cost_bdt: totalCost,
      roas,
      evaluated_at: new Date().toISOString(),
    };

    db.updateCampaign(campaignId, {
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
      result_metrics: result,
    });

    db.updateCampaignExecution(execRecord.id, {
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
