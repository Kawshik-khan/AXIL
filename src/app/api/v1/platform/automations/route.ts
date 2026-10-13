import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformAuthorizationService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";
import { ProviderCircuitBreakerService } from "@/domains/automation/services/provider-circuit-breaker.service";
import { WebhookGatewayService } from "@/domains/automation/services/webhook-gateway.service";
import { DeadLetterService } from "@/domains/automation/services/dead-letter.service";
import { AppError, NotFoundError } from "@/lib/errors";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "automation.read");

    const automations = db.data.automations || [];
    const executions = db.data.automation_executions || [];
    const deadLetters = db.data.automation_dead_letters || [];
    const webhooks = db.data.automation_webhooks || [];
    const n8nInstances = db.data.n8n_instances || [];
    const killSwitches = db.data.automation_kill_switches || [];

    const enrichedAutomations = automations.slice(0, 100).map((a) => {
      const tenant = db.findTenantById(a.tenant_id);
      return {
        ...a,
        tenant_name: tenant?.name ?? a.tenant_id,
        tenant_slug: tenant?.slug ?? null,
      };
    });

    const enrichedExecutions = executions.slice(0, 50).map((e) => {
      const tenant = db.findTenantById(e.tenant_id);
      return {
        id: e.id,
        tenant_id: e.tenant_id,
        tenant_name: tenant?.name ?? e.tenant_id,
        automation_id: e.automation_id,
        status: e.status,
        duration_ms: e.duration_ms,
        error_message: (e as any).error_message || e.error_message_reference,
        retry_count: (e as any).retry_count || 0,
        created_at: e.created_at,
      };
    });

    const enrichedDeadLetters = deadLetters.map((dl) => {
      const tenant = db.findTenantById(dl.tenant_id);
      return {
        ...dl,
        tenant_name: tenant?.name || dl.tenant_id,
      };
    });

    const enrichedWebhooks = webhooks.map((w) => {
      const tenant = db.findTenantById(w.tenant_id);
      return {
        id: w.id,
        tenant_id: w.tenant_id,
        tenant_name: tenant?.name ?? (w.tenant_id ? w.tenant_id : "Platform"),
        provider: w.provider,
        endpoint_path: w.endpoint_path,
        ingress_path: `${w.endpoint_path}?wh=${encodeURIComponent(w.id)}`,
        secret_configured: WebhookGatewayService.isWebhookSecretConfigured(w.secret_reference),
        signature_algorithm: w.signature_algorithm,
        is_active: w.is_active,
        last_event_at: w.last_event_at,
        failure_rate: w.failure_rate || 0,
      };
    });

    const circuitBreakers = ProviderCircuitBreakerService.getPlatformProviderStates();

    const activeKillSwitch = killSwitches.find((k) => k.active);
    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter((e) => e.status === "SUCCESS").length;
    const webhookSuccessRate = totalExecutions > 0 ? Number((successfulExecutions / totalExecutions).toFixed(4)) : null;

    const health = {
      overall_status: activeKillSwitch ? "HALTED" : "HEALTHY",
      active_automations_count: automations.filter((a) => a.status === "ACTIVE").length,
      webhook_success_rate: webhookSuccessRate,
      average_duration_ms: totalExecutions > 0
        ? Math.round(executions.reduce((acc, e) => acc + (e.duration_ms || 0), 0) / totalExecutions)
        : null,
      retry_count: (db.data.automation_retries || []).filter((r) => r.status === "PENDING").length,
      dead_letter_count: deadLetters.length,
      kill_switch_active: !!activeKillSwitch,
      kill_switch_reason: activeKillSwitch?.reason || null,
    };

    return apiSuccess({
      automations: enrichedAutomations,
      recent_executions: enrichedExecutions,
      dead_letter_count: deadLetters.length,
      dead_letters: enrichedDeadLetters,
      circuit_breakers: circuitBreakers,
      webhooks: enrichedWebhooks,
      n8n_instances: n8nInstances,
      health,
    });
  } catch (error) {
    return apiError(error);
  }
}

const ActionSchema = z
  .object({
    action: z.enum([
      "RETRY_DEAD_LETTER",
      "RESOLVE_DEAD_LETTER",
      "RESET_CIRCUIT_BREAKER",
      "TRIP_CIRCUIT_BREAKER",
    ]),
    dead_letter_id: z.string().optional(),
    tenant_id: z.string().optional(),
    provider_key: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = ActionSchema.parse(await request.json());

    if (body.action === "RETRY_DEAD_LETTER") {
      PlatformAuthorizationService.assertCan(context, "dlq.retry");
      if (!body.dead_letter_id) throw new AppError("ID_REQUIRED", "dead_letter_id is required", 400);

      const dlq = (db.data.automation_dead_letters || []).find((d) => d.id === body.dead_letter_id);
      if (!dlq) throw new NotFoundError("Dead letter");

      const tenantId = body.tenant_id || dlq.tenant_id;
      const result = await DeadLetterService.retryDeadLetter(
        tenantId,
        body.dead_letter_id,
        context.platformUser.id
      );
      return apiSuccess({ message: "Dead letter replayed successfully", result });
    }

    if (body.action === "RESOLVE_DEAD_LETTER") {
      PlatformAuthorizationService.assertCan(context, "dlq.resolve");
      if (!body.dead_letter_id) throw new AppError("ID_REQUIRED", "dead_letter_id is required", 400);

      const dlq = (db.data.automation_dead_letters || []).find((d) => d.id === body.dead_letter_id);
      if (!dlq) throw new NotFoundError("Dead letter");

      const tenantId = body.tenant_id || dlq.tenant_id;
      const result = DeadLetterService.resolveDeadLetter(
        tenantId,
        body.dead_letter_id,
        context.platformUser.id,
        body.notes || "Resolved by platform operator"
      );
      return apiSuccess({ message: "Dead letter marked resolved", result });
    }

    if (body.action === "RESET_CIRCUIT_BREAKER") {
      PlatformAuthorizationService.assertCan(context, "provider.manage");
      if (!body.provider_key) throw new AppError("PROVIDER_REQUIRED", "provider_key is required", 400);
      ProviderCircuitBreakerService.resetPlatform(body.provider_key);
      return apiSuccess({
        message: `Circuit breaker reset for ${body.provider_key}`,
        circuit_breakers: ProviderCircuitBreakerService.getPlatformProviderStates(),
      });
    }

    if (body.action === "TRIP_CIRCUIT_BREAKER") {
      PlatformAuthorizationService.assertCan(context, "provider.manage");
      if (!body.provider_key) throw new AppError("PROVIDER_REQUIRED", "provider_key is required", 400);
      ProviderCircuitBreakerService.tripPlatform(body.provider_key);
      return apiSuccess({
        message: `Circuit breaker tripped for ${body.provider_key}`,
        circuit_breakers: ProviderCircuitBreakerService.getPlatformProviderStates(),
      });
    }

    throw new AppError("INVALID_ACTION", "Unrecognized platform automation action", 400);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
