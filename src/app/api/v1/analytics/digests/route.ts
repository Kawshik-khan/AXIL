import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { analyticsService } from "@/domains/analytics/analytics.service";

const GenerateDigestSchema = z.object({
  period_type: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
});

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const digests = await analyticsService.getExecutiveDigests(context);
    return apiSuccess({ digests, total: digests.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
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
