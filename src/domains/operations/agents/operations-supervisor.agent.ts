/**
 * CommerceOS Phase 8: Autonomous Operations Supervisor Agent
 * Formulates structured multi-agent DAG plans, monitors operational events,
 * coordinates specialized domain agents, checks autonomy policy boundaries, and manages escalations.
 */

import { AgentType } from "@/types/ai";
import { WorkflowPlanStep, ActionRiskLevel } from "@/types/orchestration";
import { planValidator } from "@/domains/ai/orchestration/planning/plan-validator";

export interface OperationsPlanRequest {
  objective: string;
  domain?: string;
  context?: Record<string, unknown>;
  templateCode?: string;
}

export class OperationsSupervisorAgent {
  public readonly agentType: AgentType = "OPERATIONS_SUPERVISOR";

  /**
   * Decomposes an operational objective into a topologically validated multi-agent DAG
   */
  public decomposeOperationsObjective(req: OperationsPlanRequest): WorkflowPlanStep[] {
    const text = (req.objective + " " + (req.templateCode || "")).toLowerCase();

    // Pattern 1: Low Stock & Automated Replenishment
    if (text.includes("replenish") || text.includes("stockout") || text.includes("low stock") || req.templateCode === "REPLENISH_LOW_STOCK") {
      const steps: WorkflowPlanStep[] = [
        {
          task_type: "AUDIT_STOCKOUT_RISKS",
          objective: "Audit physical warehouse inventory and calculate 30-day velocity and days of supply remaining",
          agent_type: "INVENTORY_OPERATIONS",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["get_inventory_levels", "get_inventory_forecast"],
        },
        {
          task_type: "COMPUTE_REPLENISHMENT_QUANTITY",
          objective: "Evaluate supplier MOQ, lead times, and unit costs to determine optimal reorder quantity",
          agent_type: "PROCUREMENT",
          dependencies: ["AUDIT_STOCKOUT_RISKS"],
          risk_level: "LOW",
          required_tools: ["get_suppliers", "get_supplier_price"],
        },
        {
          task_type: "DRAFT_PURCHASE_ORDER",
          objective: "Draft formal Purchase Order in Commerce Core conforming to supplier terms",
          agent_type: "PROCUREMENT",
          dependencies: ["COMPUTE_REPLENISHMENT_QUANTITY"],
          risk_level: "MEDIUM",
          required_tools: ["create_purchase_order"],
        },
        {
          task_type: "POLICY_AND_BUDGET_VERIFICATION",
          objective: "Verify PO amount against tenant daily autonomy spend limits and budget ceilings",
          agent_type: "OPERATIONS_SUPERVISOR",
          dependencies: ["DRAFT_PURCHASE_ORDER"],
          risk_level: "LOW",
          required_tools: ["get_autonomy_budget"],
        },
        {
          task_type: "SUBMIT_OR_APPROVE_PO",
          objective: "Submit purchase order directly or route to human approver if above threshold",
          agent_type: "PROCUREMENT",
          dependencies: ["POLICY_AND_BUDGET_VERIFICATION"],
          risk_level: "HIGH",
          required_tools: ["submit_purchase_order"],
        },
      ];
      return this.validateAndReturn(steps);
    }

    // Pattern 2: Delayed Shipment & Courier Failover
    if (text.includes("shipment") || text.includes("courier") || text.includes("delay") || req.templateCode === "RECOVER_DELAYED_SHIPMENT") {
      const steps: WorkflowPlanStep[] = [
        {
          task_type: "AUDIT_COURIER_TRANSIT_STATUS",
          objective: "Query courier tracking API to detect transit bottleneck or failed delivery scans",
          agent_type: "SHIPPING_OPERATIONS",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["get_shipment_tracking"],
        },
        {
          task_type: "EVALUATE_ALTERNATE_COURIERS",
          objective: "Compare delivery performance, SLA compliance, and rate cards of alternate logistics providers",
          agent_type: "SHIPPING_OPERATIONS",
          dependencies: ["AUDIT_COURIER_TRANSIT_STATUS"],
          risk_level: "LOW",
          required_tools: ["select_best_courier"],
        },
        {
          task_type: "NOTIFY_CUSTOMER_PROACTIVELY",
          objective: "Draft and dispatch empathetic Banglish delivery update to customer via WhatsApp",
          agent_type: "CUSTOMER_SUPPORT_OPERATIONS",
          dependencies: ["EVALUATE_ALTERNATE_COURIERS"],
          risk_level: "MEDIUM",
          required_tools: ["create_support_ticket"],
        },
        {
          task_type: "EXECUTE_COURIER_REROUTE",
          objective: "Cancel stalled consignment and generate replacement shipment with healthy provider",
          agent_type: "SHIPPING_OPERATIONS",
          dependencies: ["EVALUATE_ALTERNATE_COURIERS"],
          risk_level: "HIGH",
          required_tools: ["switch_courier", "create_shipment"],
        },
      ];
      return this.validateAndReturn(steps);
    }

    // Pattern 3: Dynamic Pricing & Margin Optimization
    if (text.includes("pricing") || text.includes("margin") || text.includes("clearance") || req.templateCode === "OPTIMIZE_PRICING_MARGINS") {
      const steps: WorkflowPlanStep[] = [
        {
          task_type: "AUDIT_CATALOG_MARGINS",
          objective: "Scan catalog inventory velocity and compute gross profit margins against policy floor",
          agent_type: "PRICING_OPERATIONS",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["get_price_rules"],
        },
        {
          task_type: "SIMULATE_PRICE_ELASTICITY",
          objective: "Simulate demand elasticity, unit volume changes, and revenue impact in zero-mutation sandbox",
          agent_type: "PRICING_OPERATIONS",
          dependencies: ["AUDIT_CATALOG_MARGINS"],
          risk_level: "LOW",
          required_tools: ["simulate_price_change"],
        },
        {
          task_type: "SUBMIT_PRICE_CHANGE_REQUEST",
          objective: "Submit price change proposal with verified rollback price",
          agent_type: "PRICING_OPERATIONS",
          dependencies: ["SIMULATE_PRICE_ELASTICITY"],
          risk_level: "MEDIUM",
          required_tools: ["create_price_change_request"],
        },
        {
          task_type: "EXECUTE_PRICE_ADJUSTMENT",
          objective: "Execute price change in Commerce Core if within policy bounds, else route to approval",
          agent_type: "PRICING_OPERATIONS",
          dependencies: ["SUBMIT_PRICE_CHANGE_REQUEST"],
          risk_level: "HIGH",
          required_tools: ["execute_price_change"],
        },
      ];
      return this.validateAndReturn(steps);
    }

    // Pattern 4: Payment Reconciliation & COD Audit
    if (text.includes("reconciliation") || text.includes("finance") || text.includes("settlement") || text.includes("cod") || req.templateCode === "RECONCILE_PAYMENTS_AND_COD") {
      const steps: WorkflowPlanStep[] = [
        {
          task_type: "AUDIT_PAYMENT_LEDGER",
          objective: "Extract confirmed orders and compare expected amounts against bank/bKash settlements",
          agent_type: "RECONCILIATION",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["reconcile_payment_batch"],
        },
        {
          task_type: "IDENTIFY_FINANCIAL_DISCREPANCIES",
          objective: "Flag unsettled delivered COD orders and provider fee anomalies",
          agent_type: "FINANCE_OPERATIONS",
          dependencies: ["AUDIT_PAYMENT_LEDGER"],
          risk_level: "LOW",
          required_tools: ["get_financial_exceptions"],
        },
        {
          task_type: "PROPOSE_DISCREPANCY_RESOLUTIONS",
          objective: "Generate dispute statements or claim files for courier COD reconciliation",
          agent_type: "FINANCE_OPERATIONS",
          dependencies: ["IDENTIFY_FINANCIAL_DISCREPANCIES"],
          risk_level: "MEDIUM",
          required_tools: ["resolve_financial_exception"],
        },
      ];
      return this.validateAndReturn(steps);
    }

    // Default General Operations Audit DAG
    const defaultSteps: WorkflowPlanStep[] = [
      {
        task_type: "SCAN_OPERATIONAL_EXCEPTIONS",
        objective: "Scan tenant operational queues for open exceptions across all domains",
        agent_type: "EXCEPTION_MANAGEMENT",
        dependencies: [],
        risk_level: "LOW",
        required_tools: ["get_operational_exceptions"],
      },
      {
        task_type: "EVALUATE_OPERATIONAL_HEALTH",
        objective: "Synthesize operational golden signals and construct digital twin projection",
        agent_type: "OPERATIONS_SUPERVISOR",
        dependencies: ["SCAN_OPERATIONAL_EXCEPTIONS"],
        risk_level: "LOW",
        required_tools: ["get_autonomy_budget", "get_provider_health"],
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
      console.warn("[OperationsSupervisorAgent] Plan validation warnings:", result.errors);
    }
    return steps;
  }
}

export const operationsSupervisorAgent = new OperationsSupervisorAgent();
