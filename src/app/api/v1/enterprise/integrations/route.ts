import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { integrationHubService } from "@/domains/enterprise/services/integration-hub.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    const providers = integrationHubService.seedDefaultProviders();
    const installed = db.getIntegrationInstallations(orgId);
    const conflicts = db.getIntegrationConflicts(orgId);
    const syncs = db.getIntegrationSyncs(orgId);

    return apiSuccess({
      providers,
      installed,
      open_conflicts_count: conflicts.filter((c) => !c.resolved).length,
      recent_syncs: syncs.slice(0, 10),
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const orgId = body.organization_id || "org_default";
    const installed = integrationHubService.installIntegration(orgId, {
      providerId: body.provider_id,
      credentials: body.credentials || body.auth_config || {},
      config: body.config || {},
      syncFrequencyMinutes: body.sync_interval_minutes || body.sync_frequency_minutes || 15,
    });

    return apiSuccess(installed, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
