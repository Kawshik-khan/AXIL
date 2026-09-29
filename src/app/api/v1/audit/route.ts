import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { AuditService } from "@/domains/audit/service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUDIT_READ);

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const { logs, total } = AuditService.getLogsForTenant(context.tenant.id, limit, offset);

    return apiSuccess(
      { logs },
      {
        pagination: {
          limit,
          offset,
          total,
        },
      }
    );
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
