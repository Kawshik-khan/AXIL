/**
 * CommerceOS Phase 5: Autonomous Supervisor Agent
 * Formulates structured multi-agent plans, monitors execution, coordinates delegation, and escalates.
 */

import { AgentType } from "@/types/ai";
import { WorkflowPlanStep, ActionRiskLevel } from "@/types/orchestration";
import { agentRegistry } from "@/domains/ai/orchestration/agent-registry";

export interface PlanDecompositionRequest {
  objective: string;
  context?: Record<string, unknown>;
  templateCode?: string;
}

export class SupervisorAgent {
  public readonly agentType: AgentType = "SUPERVISOR";

  /**
   * Decomposes a business objective into a structured task graph (DAG).
   * Supports deterministic hybrid matching for known commerce patterns
   * and structured dynamic decomposition.
   */
  public decomposeObjective(req: PlanDecompositionRequest): WorkflowPlanStep[] {
    const text = (req.objective + " " + (req.templateCode || "")).toLowerCase();

    // Pattern 1: High-Value Abandoned Cart Recovery
    if (text.includes("abandoned") || text.includes("cart") || req.templateCode === "ABANDONED_CART_RECOVERY") {
      return [
        {
          task_type: "IDENTIFY_ABANDONED_CARTS",
          objective: "Query analytics and filter abandoned checkouts above minimum threshold",
          agent_type: "ORDER_ASSISTANT",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["lookup_order"],
        },
        {
          task_type: "RETRIEVE_CUSTOMER_CONTEXT",
          objective: "Retrieve customer communication preference and purchase history",
          agent_type: "CUSTOMER_SUPPORT",
          dependencies: ["IDENTIFY_ABANDONED_CARTS"],
          risk_level: "LOW",
          required_tools: ["lookup_customer"],
        },
        {
          task_type: "CHECK_PRODUCT_AVAILABILITY",
          objective: "Verify items in abandoned cart are in stock",
          agent_type: "INVENTORY",
          dependencies: ["IDENTIFY_ABANDONED_CARTS"],
          risk_level: "LOW",
          required_tools: ["check_inventory"],
        },
        {
          task_type: "GENERATE_PERSONALIZED_MESSAGE",
          objective: "Draft personalized Banglish cart recovery copy with valid coupon",
          agent_type: "SALES",
          dependencies: ["RETRIEVE_CUSTOMER_CONTEXT", "CHECK_PRODUCT_AVAILABILITY"],
          risk_level: "MEDIUM",
          required_tools: ["search_products"],
        },
        {
          task_type: "OUTBOUND_MESSAGE_APPROVAL",
          objective: "Require human authorization before mass outbound communication",
          agent_type: "SUPERVISOR",
          dependencies: ["GENERATE_PERSONALIZED_MESSAGE"],
          risk_level: "HIGH",
          required_tools: [],
        },
      ];
    }

    // Pattern 2: Low Stock Audit & Restock Analysis
    if (text.includes("stock") || text.includes("inventory") || req.templateCode === "LOW_STOCK_RESTOCK") {
      return [
        {
          task_type: "AUDIT_WAREHOUSE_STOCK",
          objective: "Scan inventory items below safety reorder threshold",
          agent_type: "INVENTORY",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["check_inventory"],
        },
        {
          task_type: "CALCULATE_SALES_VELOCITY",
          objective: "Evaluate recent sales velocity to determine optimal reorder quantity",
          agent_type: "SALES",
          dependencies: ["AUDIT_WAREHOUSE_STOCK"],
          risk_level: "LOW",
          required_tools: ["get_product_details"],
        },
        {
          task_type: "PREPARE_REORDER_PROPOSAL",
          objective: "Formulate reorder purchase order draft for supplier",
          agent_type: "ORDER_ASSISTANT",
          dependencies: ["CALCULATE_SALES_VELOCITY"],
          risk_level: "MEDIUM",
          required_tools: [],
        },
      ];
    }

    // Pattern 3: Delivery Delay & Courier Exception Resolution
    if (text.includes("delivery") || text.includes("delay") || text.includes("courier") || req.templateCode === "DELIVERY_EXCEPTION_RESOLVE") {
      return [
        {
          task_type: "TRACK_PARCEL_STATUS",
          objective: "Query courier API for latest transit scan and delay exception reason",
          agent_type: "SHIPPING",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["track_shipment"],
        },
        {
          task_type: "NOTIFY_CUSTOMER_EMPATHY",
          objective: "Draft proactive SMS/WhatsApp delay notification with updated ETA",
          agent_type: "CUSTOMER_SUPPORT",
          dependencies: ["TRACK_PARCEL_STATUS"],
          risk_level: "MEDIUM",
          required_tools: ["lookup_customer"],
        },
      ];
    }

    // Pattern 4: Disputed Payment & Refund Review
    if (text.includes("refund") || text.includes("payment failure") || req.templateCode === "REFUND_REVIEW") {
      return [
        {
          task_type: "VERIFY_PAYMENT_TRX",
          objective: "Match customer submitted TrxID with bank/bKash/Nagad settlement records",
          agent_type: "PAYMENT",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["check_payment_status"],
        },
        {
          task_type: "INSPECT_ORDER_RETURN_STATE",
          objective: "Confirm return parcel receipt at warehouse before issuing refund",
          agent_type: "ORDER_ASSISTANT",
          dependencies: ["VERIFY_PAYMENT_TRX"],
          risk_level: "LOW",
          required_tools: ["lookup_order"],
        },
        {
          task_type: "APPROVAL_REFUND_DISBURSEMENT",
          objective: "Mandatory human review and cryptographic revalidation for financial refund",
          agent_type: "SUPERVISOR",
          dependencies: ["INSPECT_ORDER_RETURN_STATE"],
          risk_level: "CRITICAL",
          required_tools: [],
        },
      ];
    }

    // Pattern 5: Wholesale Bulk Order Quote & Feasibility
    if (text.includes("wholesale") || text.includes("bulk") || text.includes("50") || req.templateCode === "WHOLESALE_QUOTE") {
      return [
        {
          task_type: "VALIDATE_PRODUCT_SPEC",
          objective: "Identify requested product catalog item and variant specifications",
          agent_type: "SALES",
          dependencies: [],
          risk_level: "LOW",
          required_tools: ["search_products", "get_product_details"],
        },
        {
          task_type: "AUDIT_BULK_STOCK",
          objective: "Verify physical quantity in warehouse and check existing reservations",
          agent_type: "INVENTORY",
          dependencies: ["VALIDATE_PRODUCT_SPEC"],
          risk_level: "LOW",
          required_tools: ["check_inventory"],
        },
        {
          task_type: "CALCULATE_BULK_SHIPPING",
          objective: "Calculate freight/courier charge and delivery timeframe for bulk weight",
          agent_type: "SHIPPING",
          dependencies: ["AUDIT_BULK_STOCK"],
          risk_level: "LOW",
          required_tools: ["get_shipping_estimate"],
        },
        {
          task_type: "FORMULATE_WHOLESALE_QUOTE",
          objective: "Draft wholesale tiered quote and prepare order draft",
          agent_type: "SALES",
          dependencies: ["CALCULATE_BULK_SHIPPING"],
          risk_level: "MEDIUM",
          required_tools: ["calculate_cart_totals", "create_order_draft"],
        },
      ];
    }

    // Generic Fallback Plan
    return [
      {
        task_type: "ANALYZE_REQUEST",
        objective: req.objective,
        agent_type: "SALES",
        dependencies: [],
        risk_level: "LOW",
        required_tools: ["search_products"],
      },
    ];
  }

  /**
   * Evaluates whether an agent has exceeded policy, or if human escalation is required
   */
  public evaluateEscalation(
    currentStep: number,
    totalSteps: number,
    failedAttempts: number,
    riskLevel: ActionRiskLevel
  ): { escalate: boolean; reason?: string } {
    if (failedAttempts >= 3) {
      return {
        escalate: true,
        reason: `Maximum task retry attempts (3) exhausted at step ${currentStep}/${totalSteps}.`,
      };
    }

    if (riskLevel === "CRITICAL") {
      return {
        escalate: true,
        reason: "CRITICAL risk level operation requires explicit human-in-the-loop signoff.",
      };
    }

    return { escalate: false };
  }
}

export const supervisorAgent = new SupervisorAgent();
