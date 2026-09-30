import { z } from "zod";
import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";
import { enforceRateLimit } from "@/lib/rate-limit";

const MINUTE = 60_000;

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
    await enforceRateLimit(`webhook-subscribe:tenant:${context.tenant.id}`, 10, MINUTE);
    const body = SubscribeBody.parse(await request.json());
    const orgId = resolveOrganizationId(context, body.organization_id);

    // https on a standard port, never a private, loopback or link-local address (SSRF guard, FX-54). The DNS check
    // happens here, outside the store lock (Phase 5 review H1); only the save is a unit of work.
    const target = await webhookPlatformService.prepareTarget(body.url);
    const subscription = await db.unit(
      async () =>
        webhookPlatformService.createSubscription(
          orgId,
          target,
          { eventTypes: body.events, applicationId: body.application_id },
          { tenantId: context.tenant.id, userId: context.user.id }
        ),
      () => true
    );

    return apiSuccess(subscription, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST, { unit: false }); // checks the target over the network first
