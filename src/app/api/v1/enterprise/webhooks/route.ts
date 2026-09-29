import { z } from "zod";
import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    // The signing secret is returned once, when the subscription is created; never in listings (FX-31)
    const webhooks = db.getEnterpriseWebhooks(orgId).map(({ secret: _secret, ...rest }) => rest);
    return apiSuccess({
      total: webhooks.length,
      webhooks,
    });
  } catch (err) {
    return apiError(err);
  }
}

const SubscribeBody = z
  .object({
    url: z.string().min(1).max(2048),
    events: z.array(z.string().min(1).max(100)).min(1).max(50).default(["order.created"]),
    application_id: z.string().min(1).max(100).optional(),
    organization_id: z.string().min(1).max(100).optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_MANAGE);
    const body = SubscribeBody.parse(await request.json());
    const orgId = resolveOrganizationId(context, body.organization_id);

    // https only, and never a private, loopback or link-local address (SSRF guard, FX-54)
    const subscription = await webhookPlatformService.subscribe(orgId, {
      targetUrl: body.url,
      eventTypes: body.events,
      applicationId: body.application_id,
    });

    return apiSuccess(subscription, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
