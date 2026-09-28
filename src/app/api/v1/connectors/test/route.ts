import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { enforceRateLimit } from "@/lib/rate-limit";

const MINUTE = 60_000;

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    // Some providers are now checked live with the submitted key, so this is limited to people who can change
    // settings, and rate limited so it can't be used to test API keys in bulk (Phase 3 security review F4)
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    enforceRateLimit(`connector-test:tenant:${context.tenant.id}`, 10, MINUTE);
    const body = await request.json();

    const result = await ConnectorService.testConnection(context, body);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
