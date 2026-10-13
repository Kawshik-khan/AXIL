import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { analyticsService } from "@/domains/analytics/analytics.service";
import { withStore } from "@/lib/store-unit";
import { COMMERCE_ANALYTICS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";
import { PERMISSIONS } from "@/lib/permissions";

const GenerateDigestSchema = z.object({
  period_type: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
});

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const digests = await analyticsService.getExecutiveDigests(context);
    return apiSuccess({ digests, total: digests.length });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json().catch(() => ({}));
    const validated = GenerateDigestSchema.parse(body);

    const digest = await analyticsService.generateExecutiveDigest(context, {
      period_type: validated.period_type,
    });

    return apiSuccess({ digest }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST, { tenantRows: { collections: COMMERCE_ANALYTICS_COLLECTIONS, permission: PERMISSIONS.ANALYTICS_READ } });
