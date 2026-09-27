/**
 * CommerceOS Phase 7: Growth Supervisor & Multi-Agent Planning Agent
 * Formulates validated multi-agent DAGs for revenue acceleration, customer retention, and campaign execution.
 */

import { AgentType } from "@/types/ai";
import { WorkflowPlanStep, ActionRiskLevel } from "@/types/orchestration";
import { planValidator } from "@/domains/ai/orchestration/planning/plan-validator";

export interface GrowthPlanRequest {
  objective: string;
  targetMetric?: string;
  context?: Record<string, unknown>;
}

export class GrowthSupervisorAgent {
  public readonly agentType: AgentType = "GROWTH_STRATEGIST";

  /**
   * Decomposes a commercial growth objective into a validated multi-agent execution DAG
   */
  public decomposeGrowthObjective(req: GrowthPlanRequest): WorkflowPlanStep[] {
    const text = req.objective.toLowerCase();

    // Pattern 1: Increase Repeat Purchases & Retention
    if (text.includes("repeat") || text.includes("retention") || text.includes("repurchase")) {
      const steps: WorkflowPlanStep[] = [
        {
          task_type: "ANALYZE_REPEAT_RATE",
          objective: "Analyze historical repeat customer rate and calculate first-to-second purchase velocity",
          agent_type: "CUSTOMER_LIFECYCLE",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["get_customer_lifecycle"],
        },
        {
          task_type: "IDENTIFY_SEGMENTS",
          objective: "Segment customer base into Active, Repeat, Loyal, and At-Risk cohorts",
          agent_type: "AUDIENCE_ANALYST",
          dependencies: ["ANALYZE_REPEAT_RATE"],
          risk_level: "LOW",
          required_tools: ["get_audience", "evaluate_segment"],
        },
        {
          task_type: "IDENTIFY_PRODUCT_AFFINITY",
          objective: "Compute co-purchase affinity pairs to identify top second-order candidate products",
          agent_type: "PRODUCT_RECOMMENDER",
          dependencies: ["ANALYZE_REPEAT_RATE"],
          risk_level: "LOW",
          required_tools: ["get_product_recommendations"],
        },
        {
          task_type: "DRAFT_PERSONALIZED_CAMPAIGN",
          objective: "Draft grounded Banglish WhatsApp messaging with tailored cross-sell product recommendations",
          agent_type: "CONTENT_AGENT",
          dependencies: ["IDENTIFY_SEGMENTS", "IDENTIFY_PRODUCT_AFFINITY"],
          risk_level: "MEDIUM",
          required_tools: ["generate_content", "validate_content"],
        },
        {
          task_type: "SIMULATE_CAMPAIGN_IMPACT",
          objective: "Simulate campaign reach, order velocity, discount margin impact, and projected ROI",
          agent_type: "SIMULATION",
          dependencies: ["DRAFT_PERSONALIZED_CAMPAIGN"],
          risk_level: "LOW",
          required_tools: ["simulate_campaign"],
        },
        {
          task_type: "VERIFY_COMMERCE_INVARIANTS",
          objective: "Verify product stock availability and price accuracy against Commerce Core",
          agent_type: "VERIFIER",
          dependencies: ["SIMULATE_CAMPAIGN_IMPACT"],
          risk_level: "LOW",
          required_tools: ["validate_content"],
        },
        {
          task_type: "SUBMIT_APPROVAL_GATE",
          objective: "Submit campaign proposal to Phase 5 Approval Engine if risk exceeds policy limit",
          agent_type: "SUPERVISOR",
          dependencies: ["VERIFY_COMMERCE_INVARIANTS"],
          risk_level: "HIGH",
          required_tools: ["schedule_campaign"],
        },
      ];

      return this.validateAndReturn(steps);
    }

    // Pattern 2: Dormant Customer Win-Back
    if (text.includes("win-back") || text.includes("dormant") || text.includes("reactivat")) {
      const steps: WorkflowPlanStep[] = [
        {
          task_type: "QUERY_DORMANT_CUSTOMERS",
          objective: "Filter customers inactive for 45+ days with >৳2,000 historical spend",
          agent_type: "AUDIENCE_ANALYST",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["get_audience"],
        },
        {
          task_type: "EVALUATE_WINBACK_OFFER",
          objective: "Select and simulate margin safety of 15% win-back comeback offer",
          agent_type: "OFFER_AGENT",
          dependencies: ["QUERY_DORMANT_CUSTOMERS"],
          risk_level: "LOW",
          required_tools: ["simulate_campaign"],
        },
        {
          task_type: "CHECK_CONSENT_AND_CAPS",
          objective: "Filter dormant audience by active WhatsApp marketing consent and frequency caps",
          agent_type: "CUSTOMER_LIFECYCLE",
          dependencies: ["QUERY_DORMANT_CUSTOMERS"],
          risk_level: "LOW",
          required_tools: ["check_consent", "check_frequency_cap"],
        },
        {
          task_type: "GENERATE_WINBACK_BROADCAST",
          objective: "Draft personalized win-back message variants with valid coupon code",
          agent_type: "CONTENT_AGENT",
          dependencies: ["EVALUATE_WINBACK_OFFER", "CHECK_CONSENT_AND_CAPS"],
          risk_level: "MEDIUM",
          required_tools: ["generate_content"],
        },
        {
          task_type: "VERIFY_STOCK_AND_PRICES",
          objective: "Verify promoted products have positive inventory in warehouse",
          agent_type: "VERIFIER",
          dependencies: ["GENERATE_WINBACK_BROADCAST"],
          risk_level: "LOW",
          required_tools: ["validate_content"],
        },
      ];

      return this.validateAndReturn(steps);
    }

    // Default General Growth Strategy DAG
    const defaultSteps: WorkflowPlanStep[] = [
      {
        task_type: "AUDIT_LIFECYCLE_FUNNEL",
        objective: "Audit customer lifecycle stage distribution and churn risk levels",
        agent_type: "CUSTOMER_LIFECYCLE",
        dependencies: [],
        risk_level: "LOW",
        required_tools: ["get_customer_lifecycle"],
      },
      {
        task_type: "SYNTHESIZE_GROWTH_STRATEGY",
        objective: "Formulate grounded growth recommendations and projected revenue gains",
        agent_type: "GROWTH_STRATEGIST",
        dependencies: ["AUDIT_LIFECYCLE_FUNNEL"],
        risk_level: "LOW",
        required_tools: ["get_campaign_metrics"],
      },
    ];

    return this.validateAndReturn(defaultSteps);
  }

  private validateAndReturn(steps: WorkflowPlanStep[]): WorkflowPlanStep[] {
    const definitions = steps.map((s) => ({
      id: s.task_type,
      name: s.task_type,
      objective: s.objective,
      agent_type: s.agent_type,
      action: s.task_type,
      dependencies: s.dependencies,
      risk_level: s.risk_level,
      required_tools: s.required_tools,
    }));
    const result = planValidator.validate(definitions);
    if (!result.isValid) {
      console.warn("[GrowthSupervisorAgent] DAG validation warnings/errors:", result.errors);
    }
    return steps;
  }
}

export const growthSupervisorAgent = new GrowthSupervisorAgent();

