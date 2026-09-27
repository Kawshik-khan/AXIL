import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { PlatformAuthorizationService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "automation.read");

    const automations = db.data.automations || [];
    const executions = db.data.automation_executions || [];
    const deadLetters = db.data.automation_dead_letters || [];

    const enrichedAutomations = automations.slice(0, 100).map((a) => {
      const tenant = db.findTenantById(a.tenant_id);
      return {
        ...a,
        tenant_name: tenant?.name || "Unknown",
        tenant_slug: tenant?.slug || "",
      };
    });

    const enrichedExecutions = executions.slice(0, 50).map((e) => {
      const tenant = db.findTenantById(e.tenant_id);
      return {
        id: e.id,
        tenant_id: e.tenant_id,
        tenant_name: tenant?.name || "Unknown",
        automation_id: e.automation_id,
        status: e.status,
        duration_ms: e.duration_ms,
        error_message: (e as any).error_message || e.error_message_reference,
        retry_count: (e as any).retry_count || 0,
        created_at: e.created_at,
      };
    });

    return apiSuccess({
      automations: enrichedAutomations,
      recent_executions: enrichedExecutions,
      dead_letter_count: deadLetters.length,
      dead_letters: deadLetters.slice(0, 20),
    });
  } catch (error) {
    return apiError(error);
  }
}
