import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { providerHealthService } from "@/domains/operations/services/provider-health.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;

    const healthMap = providerHealthService.getProviderHealthMap(tenantId);
    return apiSuccess({
      providers: healthMap,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const { provider, success, latency_ms } = body;
    const updated = providerHealthService.recordCall(tenantId, provider, {
      success,
      latencyMs: latency_ms || 150,
    });

    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}
