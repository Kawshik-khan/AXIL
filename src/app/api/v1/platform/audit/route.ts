import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuditService, PlatformAuthorizationService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "audit.read");

    const { searchParams } = new URL(request.url);
    const actorId = searchParams.get("actorId") || undefined;
    const tenantId = searchParams.get("tenantId") || undefined;
    const action = searchParams.get("action") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;

    const result = PlatformAuditService.query({ actorId, tenantId, action, limit, offset });
    return apiSuccess(result.logs, { total: result.total, limit, offset });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "audit.export");

    const body = await request.json().catch(() => ({}));
    const tenantId = body.tenantId || undefined;
    const limit = body.limit ? parseInt(body.limit, 10) : 1000;

    const exportData = PlatformAuditService.exportAuditLedger({ tenantId, limit });
    return apiSuccess(exportData);
  } catch (error) {
    return apiError(error);
  }
}
