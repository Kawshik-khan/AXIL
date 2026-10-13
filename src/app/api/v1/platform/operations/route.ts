import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformAuthorizationService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";
import { operationalTwinService } from "@/domains/operations/services/operational-twin.service";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";
import { providerHealthService } from "@/domains/operations/services/provider-health.service";
import { exceptionManagementService } from "@/domains/operations/services/exception-management.service";
import { operationsWorkflowService } from "@/domains/operations/services/operations-workflow.service";
import { AppError } from "@/lib/errors";
import { OPERATIONS_COLLECTIONS, loadTenantRows } from "@/infrastructure/db/tenant-rows";

const TriggerWorkflowSchema = z.object({
  action: z.literal("TRIGGER_WORKFLOW"),
  tenant_id: z.string().min(1),
  workflow_type: z.string().min(1),
  failing_courier: z.string().optional(),
}).strict();

const ResolveExceptionSchema = z.object({
  action: z.literal("RESOLVE_EXCEPTION"),
  tenant_id: z.string().min(1),
  exception_id: z.string().min(1),
  resolution_notes: z.string().min(1),
}).strict();

const UpdateBudgetSchema = z.object({
  action: z.literal("UPDATE_BUDGET"),
  tenant_id: z.string().min(1),
  daily_max_spend_bdt: z.number().finite().min(0).max(10_000_000).optional(),
  daily_max_actions: z.number().int().min(0).max(100_000).optional(),
  daily_max_llm_cost_usd: z.number().finite().min(0).max(10_000).optional(),
}).strict();

const ToggleKillSwitchSchema = z.object({
  action: z.literal("TOGGLE_KILL_SWITCH"),
  tenant_id: z.string().min(1),
  emergency_stopped: z.boolean(),
  reason: z.string().optional(),
}).strict();

const ActionBodySchema = z.discriminatedUnion("action", [
  TriggerWorkflowSchema,
  ResolveExceptionSchema,
  UpdateBudgetSchema,
  ToggleKillSwitchSchema,
]);

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "operations.platform.read");

    const tenants = (db.data.tenants || []).map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
    }));

    const { searchParams } = new URL(request.url);
    const requestedTenantId = searchParams.get("tenant_id");
    const selectedTenantId = requestedTenantId || tenants[0]?.id || "";

    let twin = null;
    let budget = null;
    let providers: Record<string, unknown> = {};
    let exceptions: unknown[] = [];
    let receipts: unknown[] = [];

    if (selectedTenantId) {
      await loadTenantRows(selectedTenantId, OPERATIONS_COLLECTIONS); // zero-hydration: what the twin reads (read-only)
      twin = operationalTwinService.getDigitalTwin(selectedTenantId);
      budget = operationalBudgetService.getBudget(selectedTenantId);
      providers = providerHealthService.getProviderHealthMap(selectedTenantId);
      exceptions = db.getOperationalExceptions(selectedTenantId);
      receipts = db.getActionReceipts(selectedTenantId);
    }

    // Fleet-wide health metrics
    const allExceptions = db.data.operational_exceptions || [];
    const openFleetExceptions = allExceptions.filter((e) => e.status !== "RESOLVED");
    const allBudgets = db.data.autonomy_budgets || [];
    const haltedTenants = allBudgets.filter((b) => b.emergency_stopped).map((b) => b.tenant_id);

    return apiSuccess({
      selected_tenant_id: selectedTenantId,
      tenants,
      twin,
      budget,
      providers,
      exceptions,
      receipts,
      fleet_summary: {
        total_tenants: tenants.length,
        total_open_exceptions: openFleetExceptions.length,
        total_receipts: (db.data.action_receipts || []).length,
        halted_tenants_count: haltedTenants.length,
        halted_tenant_ids: haltedTenants,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "operations.platform.manage");

    const body = ActionBodySchema.parse(await request.json());
    const operatorName = context.platformUser.name || context.platformUser.email || "Platform Operator";

    switch (body.action) {
      case "TRIGGER_WORKFLOW": {
        let result: unknown;
        // Zero-hydration: the workspace's rows the operations workflows read and change
        if (body.tenant_id) await loadTenantRows(body.tenant_id, OPERATIONS_COLLECTIONS);
        switch (body.workflow_type) {
          case "LOW_STOCK_REPLENISHMENT":
          case "STOCKOUT_REORDER":
            result = await operationsWorkflowService.executeLowStockReplenishment(body.tenant_id);
            break;
          case "STOCKOUT_PREVENTION":
          case "WAREHOUSE_BALANCING":
            result = await operationsWorkflowService.executeStockoutPrevention(body.tenant_id);
            break;
          case "DELAYED_SHIPMENT_FAILOVER":
          case "DELAYED_SHIPMENT_RECOVERY":
            result = await operationsWorkflowService.executeDelayedShipmentRecovery(body.tenant_id);
            break;
          case "PAYMENT_FAILURE_RECOVERY":
          case "UNRECONCILED_PAYMENT":
            result = await operationsWorkflowService.executePaymentFailureRecovery(body.tenant_id);
            break;
          case "ORDER_EXCEPTION_RECOVERY":
            result = await operationsWorkflowService.executeOrderExceptionRecovery(body.tenant_id);
            break;
          case "COURIER_FAILURE_RECOVERY":
          case "PROVIDER_OUTAGE_SWITCH":
            result = await operationsWorkflowService.executeCourierFailureRecovery(
              body.tenant_id,
              (body.failing_courier as any) || "STEADFAST"
            );
            break;
          case "REFUND_EXCEPTION_RECOVERY":
            result = await operationsWorkflowService.executeRefundExceptionRecovery(body.tenant_id);
            break;
          case "INVENTORY_RECONCILIATION":
            result = await operationsWorkflowService.executeInventoryReconciliation(body.tenant_id);
            break;
          case "DAILY_OPERATIONAL_BRIEF":
            result = await operationsWorkflowService.generateOperationalDailyBrief(body.tenant_id);
            break;
          default:
            throw new AppError("VALIDATION_ERROR", `Unsupported workflow type: ${body.workflow_type}`, 400);
        }
        return apiSuccess({ action: body.action, result });
      }

      case "RESOLVE_EXCEPTION": {
        const resolved = exceptionManagementService.resolveException(
          body.tenant_id,
          body.exception_id,
          body.resolution_notes,
          operatorName
        );
        return apiSuccess({ action: body.action, exception: resolved });
      }

      case "UPDATE_BUDGET": {
        const updates: Record<string, unknown> = {};
        if (body.daily_max_spend_bdt !== undefined) updates.daily_max_spend_bdt = body.daily_max_spend_bdt;
        if (body.daily_max_actions !== undefined) updates.daily_max_actions = body.daily_max_actions;
        if (body.daily_max_llm_cost_usd !== undefined) updates.daily_max_llm_cost_usd = body.daily_max_llm_cost_usd;

        const updated = operationalBudgetService.updateBudget(body.tenant_id, updates);
        return apiSuccess({ action: body.action, budget: updated });
      }

      case "TOGGLE_KILL_SWITCH": {
        let budget;
        if (body.emergency_stopped) {
          budget = operationalBudgetService.triggerKillSwitch(
            body.tenant_id,
            body.reason || `Halted by platform operator ${operatorName} from Super Admin`
          );
        } else {
          budget = operationalBudgetService.clearKillSwitch(body.tenant_id);
        }
        return apiSuccess({ action: body.action, budget });
      }
    }
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
