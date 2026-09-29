import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { db } from "@/infrastructure/db";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { AutomationSafetyService } from "@/domains/automation/services/automation-safety.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const health = AutomationRegistryService.getAutomationHealth(context.tenant.id);
    return apiSuccess({ health });
  } catch (err) {
    return apiError(err);
  }
}

const Body = z
  .object({
    action: z.enum(["TRIP_KILL_SWITCH", "RESUME_KILL_SWITCH"]).optional(),
    // GLOBAL and PROVIDER stop every workspace: platform operators only (the platform kill switches), never this route
    scope: z.enum(["TENANT", "WORKFLOW", "GLOBAL", "PROVIDER"]).default("TENANT"),
    target_id: z.string().min(1).max(200).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = Body.parse(await request.json().catch(() => ({})));
    if (!body.action) {
      return apiSuccess({ health: AutomationRegistryService.getAutomationHealth(context.tenant.id) });
    }
    RbacService.assertCan(context, body.action === "TRIP_KILL_SWITCH" ? PERMISSIONS.AUTOMATION_DISABLE : PERMISSIONS.AUTOMATION_ENABLE);

    // Only this workspace, or one of its own workflows
    const tenantId = context.tenant.id;
    let targetId: string;
    if (body.scope === "TENANT") {
      if (body.target_id && body.target_id !== tenantId) throw new ForbiddenError("You can only pause automations in your own workspace.");
      targetId = tenantId;
    } else if (body.scope === "WORKFLOW") {
      if (!body.target_id || !db.findAutomationWorkflowById(tenantId, body.target_id)) throw new NotFoundError("Workflow");
      targetId = body.target_id;
    } else {
      throw new ForbiddenError("Pausing every workspace or a whole provider is a platform operator action.");
    }

    if (body.action === "TRIP_KILL_SWITCH") {
      AutomationSafetyService.tripKillSwitch(body.scope, targetId, context.user.id, body.reason || "Manual kill switch triggered by user", tenantId);
      return apiSuccess({ message: "Kill switch activated", health: AutomationRegistryService.getAutomationHealth(tenantId) });
    }
    AutomationSafetyService.resumeKillSwitch(body.scope, targetId, context.user.id, tenantId);
    return apiSuccess({ message: "Kill switch resumed", health: AutomationRegistryService.getAutomationHealth(tenantId) });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
