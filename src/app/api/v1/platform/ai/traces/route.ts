import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "platform.read");

    const url = new URL(request.url);
    const injectionsOnly = url.searchParams.get("injectionsOnly") === "true";
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

    const allTraces = db.getAllAgentExecutionTraces();
    const tenants = db.getTenants();
    const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

    let filtered = allTraces;
    if (injectionsOnly) {
      filtered = filtered.filter((t) =>
        t.guardrails_triggered.includes("PROMPT_INJECTION_DETECTED")
      );
    }

    filtered.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const paged = filtered.slice(0, limit);

    const enriched = paged.map((t) => ({
      ...t,
      tenant_name: tenantMap.get(t.tenant_id) || t.tenant_id,
      user_message_preview: t.customer_message_preview || "Customer query",
    }));

    return apiSuccess({
      traces: enriched,
      total_count: filtered.length,
      injections_count: allTraces.filter((t) =>
        t.guardrails_triggered.includes("PROMPT_INJECTION_DETECTED")
      ).length,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
