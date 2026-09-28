import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { integrationHubService } from "@/domains/enterprise/services/integration-hub.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.INTEGRATIONS_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const providers = integrationHubService.listProviders(); // read-only (FX-21)
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
    RbacService.assertCan(context, PERMISSIONS.INTEGRATIONS_MANAGE);
    const body = await request.json();

    const orgId = resolveOrganizationId(context, body.organization_id);
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
