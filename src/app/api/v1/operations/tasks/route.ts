import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { operationsWorkflowService } from "@/domains/operations/services/operations-workflow.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const receipts = db.getActionReceipts(tenantId);
    return apiSuccess({
      total: receipts.length,
      tasks: receipts,
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_EXECUTE);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const { workflow_type } = body;
    let result: unknown;

    switch (workflow_type) {
      case "LOW_STOCK_REPLENISHMENT":
      case "STOCKOUT_REORDER":
        result = await operationsWorkflowService.executeLowStockReplenishment(tenantId);
        break;
      case "STOCKOUT_PREVENTION":
      case "WAREHOUSE_BALANCING":
        result = await operationsWorkflowService.executeStockoutPrevention(tenantId);
        break;
      case "DELAYED_SHIPMENT_FAILOVER":
      case "DELAYED_SHIPMENT_RECOVERY":
        result = await operationsWorkflowService.executeDelayedShipmentRecovery(tenantId);
        break;
      case "PAYMENT_FAILURE_RECOVERY":
      case "UNRECONCILED_PAYMENT":
        result = await operationsWorkflowService.executePaymentFailureRecovery(tenantId);
        break;
      case "ORDER_EXCEPTION_RECOVERY":
        result = await operationsWorkflowService.executeOrderExceptionRecovery(tenantId);
        break;
      case "COURIER_FAILURE_RECOVERY":
      case "PROVIDER_OUTAGE_SWITCH":
        result = await operationsWorkflowService.executeCourierFailureRecovery(
          tenantId,
          body.failing_courier || "STEADFAST"
        );
        break;
      case "REFUND_EXCEPTION_RECOVERY":
      case "HIGH_RETURN_INVESTIGATION":
        result = await operationsWorkflowService.executeRefundExceptionRecovery(tenantId);
        break;
      case "INVENTORY_RECONCILIATION":
        result = await operationsWorkflowService.executeInventoryReconciliation(tenantId);
        break;
      case "DAILY_OPERATIONAL_BRIEF":
      case "DAILY_FINANCE_AUDIT":
        result = await operationsWorkflowService.generateOperationalDailyBrief(tenantId);
        break;
      default:
        throw new Error(`Unsupported autonomous workflow type: ${workflow_type}`);
    }

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
