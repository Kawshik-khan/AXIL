import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";

const CreateAudienceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().default(""),
  type: z.enum(["STATIC", "DYNAMIC", "PREDICTIVE", "BEHAVIORAL", "LIFECYCLE"]).default("DYNAMIC"),
  rule_groups: z.array(
    z.object({
      conjunction: z.enum(["AND", "OR"]).default("AND"),
      conditions: z.array(
        z.object({
          field: z.string(),
          operator: z.string(),
          value: z.unknown(),
        })
      ).default([]),
    })
  ).default([]),
});

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const cohorts = marketingService.getAudienceCohorts(context.tenant.id);
    return apiSuccess({ audiences: cohorts, total: cohorts.length });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const body = await request.json();
    const validated = CreateAudienceSchema.parse(body);

    const audience = marketingService.createAudienceCohort({
      tenantId: context.tenant.id,
      name: validated.name,
      description: validated.description,
      type: validated.type as any,
      ruleGroups: validated.rule_groups as any,
      userId: context.user?.id,
    });

    return apiSuccess({ audience }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
