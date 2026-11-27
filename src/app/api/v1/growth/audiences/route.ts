import { z } from "zod";
import type { AudienceRuleGroup } from "@/types/growth";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { parseOrThrow, readJson } from "@/lib/validation";
import { audienceService } from "@/domains/growth/services/audience.service";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";
import { COMMERCE_ANALYTICS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";

/**
 * The one audience API (2026-11-26): the Marketing page's copy (`/api/v1/marketing/audiences`) was merged into it.
 * Status, size and ownership are computed server-side, never taken from the body.
 */
const CreateAudience = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    description: z.string().max(2000).default(""),
    type: z.enum(["STATIC", "DYNAMIC", "PREDICTIVE", "BEHAVIORAL", "LIFECYCLE"]).default("DYNAMIC"),
    rule_groups: z
      .array(
        z
          .object({
            conjunction: z.enum(["AND", "OR"]).default("AND"),
            conditions: z
              .array(z.object({ field: z.string().min(1), operator: z.string().min(1), value: z.unknown() }).strict())
              .max(50)
              .default([]),
          })
          .strict()
      )
      .max(50)
      .default([]),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    // Sizes are counted against the shop's customers now, not the size stored when the segment was last refreshed
    const audiences = marketingService.getAudienceCohorts(context.tenant.id);
    return apiSuccess({ audiences, total: audiences.length });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const input = parseOrThrow(CreateAudience, await readJson(request));

    const audience = audienceService.createAudience({
      tenantId: context.tenant.id,
      name: input.name,
      description: input.description,
      type: input.type,
      ruleGroups: input.rule_groups as AudienceRuleGroup[],
      createdBy: context.user?.id || "USER",
    });

    return apiSuccess({ audience }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET, { tenantRows: { collections: COMMERCE_ANALYTICS_COLLECTIONS, permission: PERMISSIONS.MARKETING_READ } });
export const POST = withStore("POST", handlePOST, { tenantRows: { collections: COMMERCE_ANALYTICS_COLLECTIONS, permission: PERMISSIONS.MARKETING_WRITE } });
