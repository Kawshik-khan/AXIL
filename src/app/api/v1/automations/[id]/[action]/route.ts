import { randomSuffix } from "@/lib/ids";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { N8nProviderService } from "@/domains/automation/services/n8n-provider.service";
import { db } from "@/infrastructure/db";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string; action: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    if (params.action === "executions") {
      const executions = db.getAutomationExecutions(context.tenant.id, {
        automationId: params.id,
      });
      return apiSuccess({ executions });
    }

    throw new BadRequestError(`Unknown action: ${params.action}`);
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string; action: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    const action = params.action.toLowerCase();

    const automation = AutomationRegistryService.getAutomationById(
      context.tenant.id,
      params.id
    );
    if (!automation) {
      throw new NotFoundError(`Automation '${params.id}' not found.`);
    }

    if (action === "enable") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_ENABLE);
      const updated = AutomationRegistryService.setAutomationStatus(
        context.tenant.id,
        params.id,
        context.user.id,
        "ENABLE"
      );
      return apiSuccess({ automation: updated });
    }

    if (action === "disable") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_DISABLE);
      const updated = AutomationRegistryService.setAutomationStatus(
        context.tenant.id,
        params.id,
        context.user.id,
        "DISABLE"
      );
      return apiSuccess({ automation: updated });
    }

    if (action === "pause") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_DISABLE);
      const updated = AutomationRegistryService.setAutomationStatus(
        context.tenant.id,
        params.id,
        context.user.id,
        "PAUSE"
      );
      return apiSuccess({ automation: updated });
    }

    if (action === "resume") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_ENABLE);
      const updated = AutomationRegistryService.setAutomationStatus(
        context.tenant.id,
        params.id,
        context.user.id,
        "RESUME"
      );
      return apiSuccess({ automation: updated });
    }

    if (action === "test") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_EXECUTE);
      const body = await request.json().catch(() => ({}));
      const workflow = db.findAutomationWorkflowById(
        context.tenant.id,
        automation.workflow_id
      );

      const result = await N8nProviderService.invokeWorkflow({
        tenantId: context.tenant.id,
        automationId: automation.id,
        workflowId: automation.workflow_id,
        workflowVersionId: automation.workflow_version_id,
        n8nInstanceId: automation.n8n_instance_id,
        webhookPath: workflow?.n8n_workflow_id || `commerceos-test`,
        event: body.event || { test: true, trigger: "manual_test" },
        correlationId: `test_corr_${Date.now()}_${randomSuffix()}`,
        idempotencyKey: `test_idemp_${Date.now()}_${randomSuffix()}`,
        executionMode: body.dry_run ? "DRY_RUN" : "TEST",
      });

      return apiSuccess({ execution: result.execution, result });
    }

    if (action === "replay") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_REPLAY);
      const body = await request.json().catch(() => ({}));
      const workflow = db.findAutomationWorkflowById(
        context.tenant.id,
        automation.workflow_id
      );

      const result = await N8nProviderService.invokeWorkflow({
        tenantId: context.tenant.id,
        automationId: automation.id,
        workflowId: automation.workflow_id,
        workflowVersionId: automation.workflow_version_id,
        n8nInstanceId: automation.n8n_instance_id,
        webhookPath: workflow?.n8n_workflow_id || `commerceos-replay`,
        event: body.event || { replay: true },
        correlationId: body.correlation_id || `replay_corr_${Date.now()}_${randomSuffix()}`,
        causationId: body.causation_id,
        idempotencyKey: `replay_idemp_${Date.now()}_${randomSuffix()}`,
        executionMode: "PRODUCTION",
      });

      return apiSuccess({ execution: result.execution, result });
    }

    throw new BadRequestError(`Unknown action: ${params.action}`);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
