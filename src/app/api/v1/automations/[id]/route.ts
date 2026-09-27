import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRegistryService } from "@/domains/automation/services/automation-registry.service";
import { NotFoundError } from "@/lib/errors";

// FX-12: workflow bindings, ownership and tenant can't be changed through this route.
const AutomationPatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    enabled: z.boolean(),
    configuration: z.record(z.unknown()),
  })
  .partial()
  .strict();

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const automation = AutomationRegistryService.getAutomationById(
      context.tenant.id,
      params.id
    );

    if (!automation) {
      throw new NotFoundError(`Automation '${params.id}' not found.`);
    }

    return apiSuccess({ automation });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_UPDATE);

    const body = parseOrThrow(AutomationPatch, await readJson(request));
    const updated = AutomationRegistryService.updateAutomation(
      context.tenant.id,
      params.id,
      context.user.id,
      body
    );

    return apiSuccess({ automation: updated });
  } catch (err) {
    return apiError(err);
  }
}
