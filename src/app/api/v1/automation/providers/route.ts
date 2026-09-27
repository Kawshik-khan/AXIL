import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ProviderCircuitBreakerService } from "@/domains/automation/services/provider-circuit-breaker.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_READ);

    const circuitStates = ProviderCircuitBreakerService.getAllProviderStates(context.tenant.id);
    const n8nInstances = db.getN8nInstances(context.tenant.id);
    const webhooks = db.getAutomationWebhooks(context.tenant.id);

    return apiSuccess({
      circuit_breakers: circuitStates,
      n8n_instances: n8nInstances,
      webhooks: webhooks.map((w) => ({
        id: w.id,
        provider: w.provider,
        endpoint_path: w.endpoint_path,
        signature_algorithm: w.signature_algorithm,
        is_active: w.is_active,
        last_event_at: w.last_event_at,
        failure_rate: w.failure_rate || 0,
      })),
    });
  } catch (err) {
    return apiError(err);
  }
}
