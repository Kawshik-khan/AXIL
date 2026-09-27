/**
 * CommerceOS Phase 8: Autonomous Operations Domain Agents
 * Implements the 14 specialized operational domain agents with concrete schemas,
 * tool mappings, risk parameters, and verification strategies.
 */

import { AgentType } from "@/types/ai";
import { ActionRiskLevel } from "@/types/orchestration";

export interface IOperationsDomainAgent {
  readonly agentType: AgentType;
  readonly name: string;
  readonly description: string;
  readonly capabilities: string[];
  readonly allowedTools: string[];
  readonly defaultRiskLevel: ActionRiskLevel;
  readonly verificationStrategy: "DOMAIN_STATE" | "TOOL_RESULT" | "PROVIDER_CONFIRMATION" | "RULE";
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export class InventoryOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "INVENTORY_OPERATIONS";
  public readonly name = "Inventory Operations Agent";
  public readonly description = "Monitors stock levels, calculates sales velocity, predicts stockouts, and balances multi-warehouse reserves.";
  public readonly capabilities = ["STOCK_MONITORING", "STOCKOUT_PREDICTION", "WAREHOUSE_TRANSFER", "SAFETY_STOCK_OPTIMIZATION"];
  public readonly allowedTools = ["get_inventory_levels", "get_inventory_forecast", "create_stock_transfer", "adjust_inventory"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

export class ProcurementAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "PROCUREMENT";
  public readonly name = "Procurement & Replenishment Agent";
  public readonly description = "Evaluates supplier MOQ, lead times, and unit costs to draft and manage purchase orders.";
  public readonly capabilities = ["SUPPLIER_COMPARISON", "MOQ_OPTIMIZATION", "PO_DRAFTING", "REORDER_PLANNING"];
  public readonly allowedTools = ["get_suppliers", "get_supplier_price", "create_purchase_order", "submit_purchase_order", "receive_purchase_order"];
  public readonly defaultRiskLevel: ActionRiskLevel = "MEDIUM";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 45000;
  public readonly maxRetries = 2;
}

export class PricingOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "PRICING_OPERATIONS";
  public readonly name = "Pricing Operations Agent";
  public readonly description = "Monitors gross margins, simulates price elasticity, manages clearance discounts, and safeguards profit floors.";
  public readonly capabilities = ["MARGIN_MONITORING", "CLEARANCE_PRICING", "PRICE_SIMULATION", "MARGIN_DEFENSE"];
  public readonly allowedTools = ["get_price_rules", "simulate_price_change", "create_price_change_request", "execute_price_change"];
  public readonly defaultRiskLevel: ActionRiskLevel = "MEDIUM";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 2;
}

export class OrderOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "ORDER_OPERATIONS";
  public readonly name = "Order Operations Agent";
  public readonly description = "Validates orders, audits fulfillment readiness, tracks order SLAs, and handles safe cancellations.";
  public readonly capabilities = ["ORDER_VALIDATION", "FULFILLMENT_READINESS", "ORDER_SLA_AUDIT", "SAFE_CANCELLATION"];
  public readonly allowedTools = ["validate_order", "cancel_order_safely", "create_fulfillment_task"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

export class FulfillmentAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "FULFILLMENT";
  public readonly name = "Fulfillment Planning Agent";
  public readonly description = "Sequences warehouse picking priorities, packaging queues, and dispatch timing.";
  public readonly capabilities = ["WAREHOUSE_SELECTION", "PICKING_PRIORITY", "PACKING_SEQUENCE", "DISPATCH_PLANNING"];
  public readonly allowedTools = ["create_fulfillment_task", "select_best_courier", "get_inventory_levels"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

export class ShippingOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "SHIPPING_OPERATIONS";
  public readonly name = "Shipping & Logistics Operations Agent";
  public readonly description = "Monitors in-transit couriers, detects delivery delays, and executes automated courier failover.";
  public readonly capabilities = ["TRANSIT_MONITORING", "COURIER_BENCHMARKING", "DELAY_EXCEPTION_HANDLING", "COURIER_FAILOVER"];
  public readonly allowedTools = ["get_shipment_tracking", "create_shipment", "select_best_courier", "switch_courier"];
  public readonly defaultRiskLevel: ActionRiskLevel = "MEDIUM";
  public readonly verificationStrategy = "PROVIDER_CONFIRMATION";
  public readonly timeoutMs = 35000;
  public readonly maxRetries = 3;
}

export class CustomerSupportOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "CUSTOMER_SUPPORT_OPERATIONS";
  public readonly name = "Support Operations Agent";
  public readonly description = "Resolves order and delivery inquiries in Banglish, creates tickets, and prioritizes escalations.";
  public readonly capabilities = ["DELIVERY_INQUIRIES", "TICKET_CREATION", "SLA_ESCALATION", "ORDER_STATUS_EXPLANATION"];
  public readonly allowedTools = ["get_support_ticket", "create_support_ticket", "resolve_support_ticket"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "TOOL_RESULT";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

export class PaymentOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "PAYMENT_OPERATIONS";
  public readonly name = "Payment Operations Agent";
  public readonly description = "Verifies bKash/Nagad transactions, flags payment timeouts, and detects duplicate transactions.";
  public readonly capabilities = ["TRANSACTION_MATCHING", "MFS_VERIFICATION", "TIMEOUT_DETECTION", "DUPLICATE_PREVENTION"];
  public readonly allowedTools = ["verify_payment_transaction", "request_refund_safely", "reconcile_payment_batch"];
  public readonly defaultRiskLevel: ActionRiskLevel = "HIGH";
  public readonly verificationStrategy = "PROVIDER_CONFIRMATION";
  public readonly timeoutMs = 40000;
  public readonly maxRetries = 2;
}

export class FinanceOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "FINANCE_OPERATIONS";
  public readonly name = "Operational Finance Agent";
  public readonly description = "Performs deterministic daily revenue reconciliation, audits courier COD, and identifies fee anomalies.";
  public readonly capabilities = ["REVENUE_AUDITING", "COD_RECONCILIATION", "FEE_AUDITING", "FINANCIAL_DISCREPANCY_QUEUE"];
  public readonly allowedTools = ["run_financial_reconciliation", "get_financial_exceptions", "resolve_financial_exception"];
  public readonly defaultRiskLevel: ActionRiskLevel = "MEDIUM";
  public readonly verificationStrategy = "RULE";
  public readonly timeoutMs = 60000;
  public readonly maxRetries = 2;
}

export class ReturnsOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "RETURNS_OPERATIONS";
  public readonly name = "Returns & Reverse Logistics Agent";
  public readonly description = "Evaluates return eligibility against policy windows, flags return fraud, and disburses verified refunds.";
  public readonly capabilities = ["RETURN_ELIGIBILITY", "REVERSE_PICKUP", "INSPECTION_VERIFICATION", "REFUND_EXECUTION"];
  public readonly allowedTools = ["request_refund_safely", "resolve_operational_exception"];
  public readonly defaultRiskLevel: ActionRiskLevel = "HIGH";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 35000;
  public readonly maxRetries = 2;
}

export class ExceptionManagementAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "EXCEPTION_MANAGEMENT";
  public readonly name = "Exception Management Agent";
  public readonly description = "Classifies operational exceptions, assigns recovery tasks to domain agents, and verifies resolution.";
  public readonly capabilities = ["EXCEPTION_TRIAGE", "ROOT_CAUSE_ANALYSIS", "RESOLUTION_PLANNING", "ESCALATION_MANAGEMENT"];
  public readonly allowedTools = ["get_operational_exceptions", "propose_exception_resolution", "resolve_operational_exception"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

export class ReconciliationAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "RECONCILIATION";
  public readonly name = "Reconciliation Agent";
  public readonly description = "Compares multi-source settlement records, transaction ledgers, and inventory balances.";
  public readonly capabilities = ["LEDGER_MATCHING", "SETTLEMENT_AUDIT", "VARIANCE_DETECTION"];
  public readonly allowedTools = ["reconcile_payment_batch", "run_financial_reconciliation"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "RULE";
  public readonly timeoutMs = 45000;
  public readonly maxRetries = 2;
}

export class SupplierOperationsAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "SUPPLIER_OPERATIONS";
  public readonly name = "Supplier Operations Agent";
  public readonly description = "Tracks supplier fulfillment rates, on-time delivery percentages, and lead-time adherence.";
  public readonly capabilities = ["SUPPLIER_EVALUATION", "LEAD_TIME_AUDIT", "FILL_RATE_TRACKING"];
  public readonly allowedTools = ["get_suppliers", "get_supplier_price"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "DOMAIN_STATE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

export class OperationsOptimizationAgent implements IOperationsDomainAgent {
  public readonly agentType: AgentType = "OPERATIONS_OPTIMIZATION";
  public readonly name = "Operations Optimization Agent";
  public readonly description = "Analyzes end-to-end commerce operational efficiency, SLA compliance, and automation cost savings.";
  public readonly capabilities = ["SLA_OPTIMIZATION", "COST_ANALYSIS", "BOTTLENECK_IDENTIFICATION"];
  public readonly allowedTools = ["get_autonomy_budget", "get_provider_health"];
  public readonly defaultRiskLevel: ActionRiskLevel = "LOW";
  public readonly verificationStrategy = "RULE";
  public readonly timeoutMs = 30000;
  public readonly maxRetries = 3;
}

// Export singletons
export const inventoryOperationsAgent = new InventoryOperationsAgent();
export const procurementAgent = new ProcurementAgent();
export const pricingOperationsAgent = new PricingOperationsAgent();
export const orderOperationsAgent = new OrderOperationsAgent();
export const fulfillmentAgent = new FulfillmentAgent();
export const shippingOperationsAgent = new ShippingOperationsAgent();
export const customerSupportOperationsAgent = new CustomerSupportOperationsAgent();
export const paymentOperationsAgent = new PaymentOperationsAgent();
export const financeOperationsAgent = new FinanceOperationsAgent();
export const returnsOperationsAgent = new ReturnsOperationsAgent();
export const exceptionManagementAgent = new ExceptionManagementAgent();
export const reconciliationAgent = new ReconciliationAgent();
export const supplierOperationsAgent = new SupplierOperationsAgent();
export const operationsOptimizationAgent = new OperationsOptimizationAgent();
