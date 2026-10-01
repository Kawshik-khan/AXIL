import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ConnectorService } from "@/domains/connectors/service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";

/**
 * GET /api/v1/connectors/catalog — the provider manifests for the UI (connector plan C0/C6).
 * Returns the full catalog with fields, guides, status, and capabilities so the UI can render forms
 * without hardcoding provider details.
 */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as any || undefined;
    const providers = ConnectorService.PROVIDERS.filter((p) => !category || p.category === category);
    return apiSuccess({ providers });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
