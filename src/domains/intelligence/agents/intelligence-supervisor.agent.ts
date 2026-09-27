/**
 * CommerceOS Phase 6: Intelligence Supervisor Agent
 * Decomposes high-level commerce intelligence and analytical queries into structured,
 * multi-agent execution plans across domain intelligence agents.
 */

import { WorkflowPlanStep, ActionRiskLevel } from "@/types/orchestration";
import { AgentType } from "@/types/ai";
import { salesIntelligenceService } from "../services/sales-intelligence.service";
import { inventoryIntelligenceService } from "../services/inventory-intelligence.service";
import { customerIntelligenceService } from "../services/customer-intelligence.service";
import { productIntelligenceService } from "../services/product-intelligence.service";
import { anomalyDetectorService } from "../services/anomaly-detector.service";
import { recommendationService } from "../services/recommendation.service";
import { forecastingService } from "../services/forecasting.service";

export interface IntelligencePlanRequest {
  tenantId: string;
  query: string;
  context?: Record<string, any>;
}

export interface IntelligenceExecutionPlan {
  id: string;
  tenant_id: string;
  goal: string;
  steps: WorkflowPlanStep[];
  context?: Record<string, any>;
  created_at: string;
}

export interface IntelligenceAnalysisResult {
  plan: IntelligenceExecutionPlan;
  summary: string;
  findings: Array<{
    agent: AgentType;
    category: string;
    details: any;
  }>;
  recommendation_ids: string[];
}

export class IntelligenceSupervisorAgent {
  /**
   * Decomposes an analytical question into a directed acyclic graph (DAG) of specialized subagents
   */
  public planIntelligenceTask(request: IntelligencePlanRequest): IntelligenceExecutionPlan {
    const { tenantId, query } = request;
    const q = query.toLowerCase();
    const planId = `plan_intel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const steps: WorkflowPlanStep[] = [];

    if (q.includes("drop") || q.includes("down") || q.includes("why did sales") || q.includes("decline")) {
      // 1. Sales drop investigation DAG
      steps.push({
        task_type: "ANALYZE_SALES_DROPS",
        objective: "Analyze 30-day sales drops and channel shifts",
        agent_type: "SALES_INTELLIGENCE",
        dependencies: [],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["analyze_sales_trends"],
      });
      steps.push({
        task_type: "DETECT_ANOMALIES",
        objective: "Detect statistical revenue shocks and payment spikes",
        agent_type: "ANOMALY_DETECTION",
        dependencies: ["ANALYZE_SALES_DROPS"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["detect_anomalies"],
      });
      steps.push({
        task_type: "CHECK_STOCKOUTS_IMPACT",
        objective: "Evaluate inventory stockout correlation with revenue drop",
        agent_type: "INVENTORY_INTELLIGENCE",
        dependencies: ["ANALYZE_SALES_DROPS"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["check_stock_health"],
      });
      steps.push({
        task_type: "SYNTHESIZE_EXECUTIVE_RECOMMENDATIONS",
        objective: "Synthesize grounded recovery proposals",
        agent_type: "RECOMMENDATION",
        dependencies: ["DETECT_ANOMALIES", "CHECK_STOCKOUTS_IMPACT"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["generate_recommendations"],
      });
    } else if (q.includes("restock") || q.includes("stock") || q.includes("eid") || q.includes("inventory")) {
      // 2. Inventory & Replenishment DAG
      steps.push({
        task_type: "ANALYZE_STOCKOUT_RISKS",
        objective: "Identify SKUs with critical days of inventory remaining",
        agent_type: "INVENTORY_INTELLIGENCE",
        dependencies: [],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["check_stock_health"],
      });
      steps.push({
        task_type: "PROJECT_DEMAND",
        objective: "Forecast 30-day demand with confidence intervals",
        agent_type: "FORECASTING",
        dependencies: ["ANALYZE_STOCKOUT_RISKS"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["forecast_demand"],
      });
      steps.push({
        task_type: "GENERATE_REORDER_PROPOSALS",
        objective: "Synthesize replenishment recommendations with lead-time buffers",
        agent_type: "RECOMMENDATION",
        dependencies: ["PROJECT_DEMAND"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["generate_recommendations"],
      });
    } else if (q.includes("churn") || q.includes("customer") || q.includes("loyal") || q.includes("rfm")) {
      // 3. Customer Retention & RFM DAG
      steps.push({
        task_type: "EVALUATE_RFM_SEGMENTS",
        objective: "Quantile segment customers into Champions, At-Risk, and Churn tiers",
        agent_type: "CUSTOMER_INTELLIGENCE",
        dependencies: [],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["analyze_rfm_segments"],
      });
      steps.push({
        task_type: "GENERATE_RETENTION_CAMPAIGNS",
        objective: "Formulate grounded WhatsApp/SMS re-engagement recommendations",
        agent_type: "RECOMMENDATION",
        dependencies: ["EVALUATE_RFM_SEGMENTS"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["generate_recommendations"],
      });
    } else {
      // 4. Default comprehensive commerce diagnostic DAG
      steps.push({
        task_type: "ANALYZE_SALES",
        objective: "Analyze aggregate sales revenue and order volumes",
        agent_type: "SALES_INTELLIGENCE",
        dependencies: [],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["analyze_sales"],
      });
      steps.push({
        task_type: "ANALYZE_CATALOG",
        objective: "Score product catalog velocity and return rates",
        agent_type: "PRODUCT_INTELLIGENCE",
        dependencies: [],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["analyze_products"],
      });
      steps.push({
        task_type: "DETECT_ANOMALIES",
        objective: "Scan for statistical anomalies across channels",
        agent_type: "ANOMALY_DETECTION",
        dependencies: ["ANALYZE_SALES"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["detect_anomalies"],
      });
      steps.push({
        task_type: "GENERATE_RECOMMENDATIONS",
        objective: "Synthesize optimization proposals",
        agent_type: "RECOMMENDATION",
        dependencies: ["ANALYZE_SALES", "ANALYZE_CATALOG", "DETECT_ANOMALIES"],
        risk_level: "LOW" as ActionRiskLevel,
        required_tools: ["generate_recommendations"],
      });
    }

    return {
      id: planId,
      tenant_id: tenantId,
      goal: query,
      steps,
      context: { initiated_by: "INTELLIGENCE_SUPERVISOR", timestamp: new Date().toISOString() },
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Executes an analytical query plan by invoking the respective domain intelligence services
   */
  public executeIntelligencePlan(tenantId: string, plan: IntelligenceExecutionPlan): IntelligenceAnalysisResult {
    const findings: Array<{ agent: AgentType; category: string; details: any }> = [];
    const recommendationIds: string[] = [];

    for (const step of plan.steps) {
      if (step.agent_type === "SALES_INTELLIGENCE") {
        const sales = salesIntelligenceService.getOverview(tenantId);
        findings.push({ agent: "SALES_INTELLIGENCE", category: "SALES_PERFORMANCE", details: sales });
      } else if (step.agent_type === "INVENTORY_INTELLIGENCE") {
        const inv = inventoryIntelligenceService.analyzeInventoryHealth(tenantId);
        findings.push({ agent: "INVENTORY_INTELLIGENCE", category: "INVENTORY_HEALTH", details: inv });
      } else if (step.agent_type === "CUSTOMER_INTELLIGENCE") {
        const cust = customerIntelligenceService.analyzeCustomers(tenantId);
        findings.push({ agent: "CUSTOMER_INTELLIGENCE", category: "CUSTOMER_RFM", details: cust });
      } else if (step.agent_type === "PRODUCT_INTELLIGENCE") {
        const prods = productIntelligenceService.analyzeProductPerformance(tenantId);
        findings.push({ agent: "PRODUCT_INTELLIGENCE", category: "PRODUCT_CATALOG", details: prods });
      } else if (step.agent_type === "ANOMALY_DETECTION") {
        const anoms = anomalyDetectorService.detectAnomalies(tenantId);
        findings.push({ agent: "ANOMALY_DETECTION", category: "DETECTED_ANOMALIES", details: anoms });
      } else if (step.agent_type === "RECOMMENDATION") {
        const recs = recommendationService.generateRecommendations(tenantId);
        findings.push({ agent: "RECOMMENDATION", category: "OPTIMIZATION_ACTIONS", details: recs });
        for (const r of recs) {
          recommendationIds.push(r.id);
        }
      }
    }

    const summary = `Executed ${plan.steps.length} analytical steps across specialized intelligence agents. Identified ${findings.length} domain insight clusters with ${recommendationIds.length} grounded optimization recommendations.`;

    return {
      plan,
      summary,
      findings,
      recommendation_ids: recommendationIds,
    };
  }
}

export const intelligenceSupervisorAgent = new IntelligenceSupervisorAgent();
