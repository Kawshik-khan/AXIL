import { z } from "zod";
import { randomUUID } from "crypto";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AutomationRouterService } from "@/domains/automation/services/automation-router.service";
import { CommerceEvent } from "@/types/commerce";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/**
 * Posts a domain event to this workspace's automations. The workspace and the actor come from the session only: the
 * body used to be cast as an event, and a `tenant_id` in it fired another workspace's automations (FX-99 Part A,
 * audit F32). A body carrying `tenant_id` or `actor_id` is now refused.
 */
const Body = z
  .object({
    id: z.string().min(1).max(200).optional(),
    type: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, "an event type like order.created"),
    version: z.string().min(1).max(20).default("1.0"),
    aggregate_type: z.string().min(1).max(100),
    aggregate_id: z.string().min(1).max(200),
    correlation_id: z.string().min(1).max(200).optional(),
    timestamp: z.string().datetime().optional(),
    payload: z.record(z.unknown()).default({}),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTOMATION_EXECUTE);
    const body = parseOrThrow(Body, await readJson(request));

    const event: CommerceEvent = {
      id: body.id ?? `evt_${randomUUID()}`,
      type: body.type,
      version: body.version,
      tenant_id: context.tenant.id,
      aggregate_type: body.aggregate_type,
      aggregate_id: body.aggregate_id,
      actor_id: context.user.id,
      correlation_id: body.correlation_id,
      timestamp: body.timestamp ?? new Date().toISOString(),
      payload: body.payload,
    };

    const routed = await AutomationRouterService.routeEvent(event);
    return apiSuccess({ routed, count: routed.length });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
