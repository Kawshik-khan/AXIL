import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ProviderCircuitBreakerService } from "@/domains/automation/services/provider-circuit-breaker.service";
import { WebhookGatewayService } from "@/domains/automation/services/webhook-gateway.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
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
        // The URL a provider must call: `wh` selects this row (and so the tenant) server-side (FX-06 step 5).
        ingress_path: `${w.endpoint_path}?wh=${encodeURIComponent(w.id)}`,
        secret_configured: WebhookGatewayService.isWebhookSecretConfigured(w.secret_reference),
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

export const GET = withStore("GET", handleGET);
