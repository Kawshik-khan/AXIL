import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AgentPolicyService } from "@/domains/ai/policy/agent-policy.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const policy = await AgentPolicyService.getPolicy(context.tenant.id);
    return apiSuccess(policy);
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_CONFIGURE);

    const body = await request.json();
    const updated = await AgentPolicyService.updatePolicy(context, body);
    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}
