import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("organization_id") || "org_default";

    const webhooks = db.getEnterpriseWebhooks(orgId);
    return apiSuccess({
      total: webhooks.length,
      webhooks,
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

    const subscription = webhookPlatformService.subscribe(orgId, {
      targetUrl: body.url,
      eventTypes: body.events || ["order.created", "inventory.low_stock"],
      applicationId: body.application_id,
    });

    return apiSuccess(subscription, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
