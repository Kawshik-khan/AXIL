import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { AutomationSafetyService } from "@/domains/automation/services/automation-safety.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const health = AutomationRegistryService.getAutomationHealth(context.tenant.id);
    return apiSuccess({ health });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json().catch(() => ({}));

    if (body.action === "TRIP_KILL_SWITCH") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_DISABLE);
      AutomationSafetyService.tripKillSwitch(
        body.scope || "TENANT",
        body.target_id || context.tenant.id,
        context.user.id,
        body.reason || "Manual kill switch triggered by user"
      );
      const health = AutomationRegistryService.getAutomationHealth(context.tenant.id);
      return apiSuccess({ message: "Kill switch activated", health });
    }

    if (body.action === "RESUME_KILL_SWITCH") {
      RbacService.assertCan(context, PERMISSIONS.AUTOMATION_ENABLE);
      AutomationSafetyService.resumeKillSwitch(
        body.scope || "TENANT",
        body.target_id || context.tenant.id,
        context.user.id
      );
      const health = AutomationRegistryService.getAutomationHealth(context.tenant.id);
      return apiSuccess({ message: "Kill switch resumed", health });
    }

    const health = AutomationRegistryService.getAutomationHealth(context.tenant.id);
    return apiSuccess({ health });
  } catch (err) {
    return apiError(err);
  }
}
