import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { developerPlatformService } from "@/domains/enterprise/services/developer-platform.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const apiKeys = db.getAPIKeys(orgId);
    const apps = db.getDeveloperApplications(orgId);

    return apiSuccess({
      api_keys: apiKeys.map((k) => ({
        ...k,
        key_hash: "***" + k.key_hash.substring(k.key_hash.length - 6),
      })),
      applications: apps,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_MANAGE);
    const body = await request.json();
    const orgId = resolveOrganizationId(context, body.organization_id);

    if (body.action === "CREATE_APP") {
      const result = developerPlatformService.createApplication(orgId, {
        name: body.name,
        description: body.description || "",
        allowedScopes: body.scopes || ["read:orders"],
        rateLimitPerMinute: body.rate_limit_per_minute,
      });
      return apiSuccess(result, undefined, 201);
    }

    // Default action: Create API key
    const result = developerPlatformService.generateApiKey(orgId, {
      name: body.name || "Default API Key",
      scopes: body.scopes || ["read:orders", "read:inventory"],
      applicationId: body.application_id,
    });

    return apiSuccess(result, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
