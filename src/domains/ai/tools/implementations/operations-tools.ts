import { AppError } from "@/lib/errors";
/**
 * CommerceOS Phase 8: Autonomous Commerce Operations Tools
 * Grounded strictly in authoritative domain operations services.
 * LLMs reason and generate tool calls; domain services execute mutations with receipts.
 */

import { z } from "zod";
import { IAgentTool } from "../tool.interface";
import { ToolDefinition, ToolRiskLevel } from "@/types/ai";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";
import { inventoryOperationsService } from "@/domains/operations/services/inventory-operations.service";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { courierOperationsService } from "@/domains/operations/services/courier-operations.service";
import { paymentOperationsService } from "@/domains/operations/services/payment-operations.service";
import { financeOperationsService } from "@/domains/operations/services/finance-operations.service";
import { exceptionManagementService } from "@/domains/operations/services/exception-management.service";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";

// ============================================================
// 1. GET INVENTORY LEVELS TOOL
// ============================================================
const GetInventoryLevelsInputSchema = z.object({
  warehouse_id: z.string().optional().describe("Filter by specific warehouse"),
  low_stock_only: z.boolean().default(false).describe("Filter only items at or below reorder point"),
});

export class GetInventoryLevelsTool implements IAgentTool<z.infer<typeof GetInventoryLevelsInputSchema>> {
  public readonly name = "get_inventory_levels";
  public readonly description = "Retrieve authoritative stock levels, reserved quantities, and available balances across warehouses.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.INVENTORY_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetInventoryLevelsInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          warehouse_id: { type: "string", description: "Warehouse ID filter" },
          low_stock_only: { type: "boolean", description: "Only return low stock items" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetInventoryLevelsInputSchema>): Promise<any> {
    let inventory = db.getInventory(context.tenant.id);
    if (input.warehouse_id) {
      inventory = inventory.filter((i) => i.warehouse_id === input.warehouse_id);
    }
    if (input.low_stock_only) {
      inventory = inventory.filter((i) => i.quantity_available <= i.reorder_point);
    }
    return {
      total_items: inventory.length,
      items: inventory.slice(0, 50),
    };
  }
}

// ============================================================
// 2. GET INVENTORY FORECAST TOOL
// ============================================================
const GetInventoryForecastInputSchema = z.object({
  forecast_days: z.number().int().min(7).max(90).default(30),
});

export class GetInventoryForecastTool implements IAgentTool<z.infer<typeof GetInventoryForecastInputSchema>> {
  public readonly name = "get_inventory_forecast";
  public readonly description = "Evaluate forward stockout risks and projected depletion dates for inventory items.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.INVENTORY_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetInventoryForecastInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          forecast_days: { type: "number", description: "Days to project into future" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext): Promise<any> {
    const risks = inventoryOperationsService.evaluateStockoutRisks(context.tenant.id);
    const transfers = inventoryOperationsService.evaluateWarehouseTransfers(context.tenant.id);
    return {
      total_assessed: risks.length,
      critical_risks: risks.filter((r) => r.risk_level === "CRITICAL"),
      high_risks: risks.filter((r) => r.risk_level === "HIGH"),
      recommended_transfers: transfers,
    };
  }
}

// ============================================================
// 3. CREATE PURCHASE ORDER TOOL
// ============================================================
const CreatePurchaseOrderInputSchema = z.object({
  supplier_id: z.string().describe("Target verified supplier ID"),
  notes: z.string().optional().describe("Operational context or restock justification"),
  items: z.array(
    z.object({
      variant_id: z.string().describe("Product variant ID"),
      quantity: z.number().int().positive().describe("Units to order"),
    })
  ).min(1).describe("List of items to restock"),
});

export class CreatePurchaseOrderTool implements IAgentTool<z.infer<typeof CreatePurchaseOrderInputSchema>> {
  public readonly name = "create_purchase_order";
  public readonly description = "Create a draft Purchase Order to restock inventory from verified suppliers.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "HIGH_RISK";
  public readonly requiredPermission = PERMISSIONS.PROCUREMENT_MANAGE;
  public readonly requiresConfirmation = true;
  public readonly schema = CreatePurchaseOrderInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          supplier_id: { type: "string", description: "Supplier ID" },
          notes: { type: "string", description: "PO notes" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                variant_id: { type: "string" },
                quantity: { type: "number" },
              },
            },
          },
        },
        required: ["supplier_id", "items"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof CreatePurchaseOrderInputSchema>): Promise<any> {
    const po = procurementService.createPurchaseOrderDraft(
      context.tenant.id,
      {
        supplierId: input.supplier_id,
        items: input.items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity })),
        notes: input.notes,
      }
    );
    return {
      purchase_order_id: po.id,
      po_number: po.po_number,
      total_amount: po.total_amount,
      status: po.status,
      items_count: po.items.length,
    };
  }
}

// ============================================================
// 4. SIMULATE PRICE CHANGE TOOL
// ============================================================
const SimulatePriceChangeInputSchema = z.object({
  product_variant_id: z.string().describe("Target variant ID"),
  proposed_price: z.number().positive().describe("Proposed new price in BDT"),
});

export class SimulatePriceChangeTool implements IAgentTool<z.infer<typeof SimulatePriceChangeInputSchema>> {
  public readonly name = "simulate_price_change";
  public readonly description = "Simulates the revenue and gross margin impact of a proposed price adjustment without modifying catalog state.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.PRICING_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = SimulatePriceChangeInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          product_variant_id: { type: "string", description: "Variant ID" },
          proposed_price: { type: "number", description: "Proposed price in BDT" },
        },
        required: ["product_variant_id", "proposed_price"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof SimulatePriceChangeInputSchema>): Promise<any> {
    const simulation = pricingOperationsService.simulatePriceChange(
      context.tenant.id,
      input.product_variant_id,
      input.proposed_price
    );
    return simulation;
  }
}

// ============================================================
// 5. EXECUTE PRICE CHANGE TOOL
// ============================================================
const ExecutePriceChangeInputSchema = z.object({
  request_id: z.string().describe("Approved price change request ID"),
});

export class ExecutePriceChangeTool implements IAgentTool<z.infer<typeof ExecutePriceChangeInputSchema>> {
  public readonly name = "execute_price_change";
  public readonly description = "Executes an approved price adjustment in the authoritative product catalog.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "HIGH_RISK";
  public readonly requiredPermission = PERMISSIONS.PRICING_MANAGE;
  public readonly requiresConfirmation = true;
  public readonly schema = ExecutePriceChangeInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          request_id: { type: "string", description: "Price change request ID" },
        },
        required: ["request_id"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ExecutePriceChangeInputSchema>): Promise<any> {
    const execution = pricingOperationsService.executePriceChange(
      context.tenant.id,
      input.request_id,
      context.user?.id || "agent_system"
    );
    return execution;
  }
}

// ============================================================
// 6. GET SHIPMENT TRACKING TOOL
// ============================================================
const GetShipmentTrackingInputSchema = z.object({
  shipment_id: z.string().describe("Shipment ID to track"),
});

export class GetShipmentTrackingTool implements IAgentTool<z.infer<typeof GetShipmentTrackingInputSchema>> {
  public readonly name = "get_shipment_tracking";
  public readonly description = "Polls real-time shipment status and tracking details.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.ORDERS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetShipmentTrackingInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          shipment_id: { type: "string", description: "Shipment ID" },
        },
        required: ["shipment_id"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetShipmentTrackingInputSchema>): Promise<any> {
    const shipment = db.findShipmentById(context.tenant.id, input.shipment_id);
    if (!shipment) throw new AppError("NOT_FOUND", `Shipment not found: ${input.shipment_id}`, 404);
    return {
      shipment_id: shipment.id,
      tracking_number: shipment.tracking_number,
      courier_provider: shipment.courier_provider,
      status: shipment.status,
      shipped_at: shipment.shipped_at,
    };
  }
}

// ============================================================
// 7. SWITCH COURIER TOOL
// ============================================================
const SwitchCourierInputSchema = z.object({
  shipment_exception_id: z.string().describe("Shipment exception ID indicating transit issues"),
});

export class SwitchCourierTool implements IAgentTool<z.infer<typeof SwitchCourierInputSchema>> {
  public readonly name = "switch_courier";
  public readonly description = "Switches an impacted consignment to an alternate healthy courier provider.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.ORDERS_WRITE;
  public readonly requiresConfirmation = false;
  public readonly schema = SwitchCourierInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          shipment_exception_id: { type: "string", description: "Shipment exception ID" },
        },
        required: ["shipment_exception_id"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof SwitchCourierInputSchema>): Promise<any> {
    const result = courierOperationsService.executeCourierFailover(
      context.tenant.id,
      input.shipment_exception_id,
      context.user?.id || "agent_system"
    );
    return result;
  }
}

// ============================================================
// 8. VERIFY PAYMENT TRANSACTION TOOL
// ============================================================
const VerifyPaymentTransactionInputSchema = z.object({
  order_id: z.string().describe("Order ID"),
  trx_id: z.string().describe("MFS Transaction ID (bKash/Nagad TrxID)"),
  expected_amount: z.number().positive().describe("Expected order total in BDT"),
});

export class VerifyPaymentTransactionTool implements IAgentTool<z.infer<typeof VerifyPaymentTransactionInputSchema>> {
  public readonly name = "verify_payment_transaction";
  public readonly description = "Verifies an incoming bKash or Nagad TrxID against settlement records.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.PAYMENTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = VerifyPaymentTransactionInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          trx_id: { type: "string" },
          expected_amount: { type: "number" },
        },
        required: ["order_id", "trx_id", "expected_amount"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof VerifyPaymentTransactionInputSchema>): Promise<any> {
    const match = paymentOperationsService.reconcileTransaction(context.tenant.id, {
      orderId: input.order_id,
      transactionId: input.trx_id,
      amount: input.expected_amount,
      actor: context.user?.id || "agent_system",
    });
    return match;
  }
}

// ============================================================
// 9. RECONCILE PAYMENT BATCH TOOL
// ============================================================
const ReconcilePaymentBatchInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});

export class ReconcilePaymentBatchTool implements IAgentTool<z.infer<typeof ReconcilePaymentBatchInputSchema>> {
  public readonly name = "reconcile_payment_batch";
  public readonly description = "Scans pending payment settlements and flags timeout anomalies.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.PAYMENTS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = ReconcilePaymentBatchInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext): Promise<any> {
    const anomalies = paymentOperationsService.monitorPendingPayments(context.tenant.id);
    return {
      anomalies_detected: anomalies.length,
      anomalies,
    };
  }
}

// ============================================================
// 10. RUN FINANCIAL RECONCILIATION TOOL
// ============================================================
const RunFinancialReconciliationInputSchema = z.object({});

export class RunFinancialReconciliationTool implements IAgentTool<z.infer<typeof RunFinancialReconciliationInputSchema>> {
  public readonly name = "run_financial_reconciliation";
  public readonly description = "Runs deterministic revenue and payment variance reconciliation across orders and payments.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.FINANCE_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = RunFinancialReconciliationInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 15000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  public async execute(context: RequestContext): Promise<any> {
    const run = financeOperationsService.executeReconciliationRun(context.tenant.id);
    return run;
  }
}

// ============================================================
// 11. GET OPERATIONAL EXCEPTIONS TOOL
// ============================================================
const GetOperationalExceptionsInputSchema = z.object({
  domain: z.string().optional().describe("Filter by operational domain"),
  severity: z.string().optional().describe("Filter by severity: LOW, MEDIUM, HIGH, CRITICAL"),
});

export class GetOperationalExceptionsTool implements IAgentTool<z.infer<typeof GetOperationalExceptionsInputSchema>> {
  public readonly name = "get_operational_exceptions";
  public readonly description = "Retrieves active operational exceptions and anomalies across all commerce domains.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.EXCEPTIONS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetOperationalExceptionsInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string" },
          severity: { type: "string" },
        },
        required: [],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof GetOperationalExceptionsInputSchema>): Promise<any> {
    let exceptions = db.getOperationalExceptions(context.tenant.id);
    if (input.domain) {
      exceptions = exceptions.filter((e) => e.domain === input.domain);
    }
    if (input.severity) {
      exceptions = exceptions.filter((e) => e.severity === input.severity);
    }
    return {
      total_exceptions: exceptions.length,
      exceptions: exceptions.slice(0, 50),
    };
  }
}

// ============================================================
// 12. RESOLVE OPERATIONAL EXCEPTION TOOL
// ============================================================
const ResolveOperationalExceptionInputSchema = z.object({
  exception_id: z.string().describe("Exception ID to resolve"),
  resolution_notes: z.string().describe("Notes describing how the issue was resolved"),
});

export class ResolveOperationalExceptionTool implements IAgentTool<z.infer<typeof ResolveOperationalExceptionInputSchema>> {
  public readonly name = "resolve_operational_exception";
  public readonly description = "Marks an operational exception as resolved with resolution audit metadata.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "LOW_RISK";
  public readonly requiredPermission = PERMISSIONS.EXCEPTIONS_MANAGE;
  public readonly requiresConfirmation = false;
  public readonly schema = ResolveOperationalExceptionInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          exception_id: { type: "string" },
          resolution_notes: { type: "string" },
        },
        required: ["exception_id", "resolution_notes"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof ResolveOperationalExceptionInputSchema>): Promise<any> {
    const updated = exceptionManagementService.resolveException(
      context.tenant.id,
      input.exception_id,
      input.resolution_notes,
      context.user?.id || "agent_system"
    );
    return updated;
  }
}

// ============================================================
// 13. GET AUTONOMY BUDGET TOOL
// ============================================================
const GetAutonomyBudgetInputSchema = z.object({});

export class GetAutonomyBudgetTool implements IAgentTool<z.infer<typeof GetAutonomyBudgetInputSchema>> {
  public readonly name = "get_autonomy_budget";
  public readonly description = "Checks remaining daily automated spending allowances, action limits, and budget health.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "INFORMATIONAL";
  public readonly requiredPermission = PERMISSIONS.OPERATIONS_READ;
  public readonly requiresConfirmation = false;
  public readonly schema = GetAutonomyBudgetInputSchema;
  public readonly idempotent = true;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  public async execute(context: RequestContext): Promise<any> {
    const budget = operationalBudgetService.getBudget(context.tenant.id);
    return budget;
  }
}

// ============================================================
// 14. TRIGGER KILL SWITCH TOOL
// ============================================================
const TriggerKillSwitchInputSchema = z.object({
  reason: z.string().describe("Emergency reason for halting autonomous actions"),
});

export class TriggerKillSwitchTool implements IAgentTool<z.infer<typeof TriggerKillSwitchInputSchema>> {
  public readonly name = "trigger_kill_switch";
  public readonly description = "EMERGENCY SAFETY: Immediately freezes all autonomous mutations across the tenant.";
  public readonly category = "OPERATIONS";
  public readonly riskLevel: ToolRiskLevel = "HIGH_RISK";
  public readonly requiredPermission = PERMISSIONS.OPERATIONS_EXECUTE;
  public readonly requiresConfirmation = true;
  public readonly schema = TriggerKillSwitchInputSchema;
  public readonly idempotent = false;

  public getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      risk_level: this.riskLevel,
      required_permission: this.requiredPermission,
      requires_confirmation: this.requiresConfirmation,
      timeout_ms: 10000,
      idempotent: this.idempotent,
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
      },
    };
  }

  public async execute(context: RequestContext, input: z.infer<typeof TriggerKillSwitchInputSchema>): Promise<any> {
    const budget = operationalBudgetService.triggerKillSwitch(
      context.tenant.id,
      input.reason
    );
    return {
      kill_switch_active: true,
      budget,
    };
  }
}
