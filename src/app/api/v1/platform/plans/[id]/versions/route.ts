import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Price = z.number().int().min(0).max(100_000_000).nullable();

const Body = z
  .object({
    monthly_price_bdt: Price,
    annual_price_bdt: Price,
    trial_days: z.number().int().min(0).max(365).nullable(),
    setup_fee_bdt: Price,
    features: z.record(z.union([z.number(), z.boolean(), z.null()])),
    change_note: z.string().trim().max(500).optional(),
  })
  .strict();

/** Saves the plan's draft version (creates one when none exists). Published versions are never edited. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractPlatformContext(request);
    const { id } = await params;
    const body = parseOrThrow(Body, await readJson(request));
    return apiSuccess(PlatformPlanService.saveDraft(context, id, body));
  } catch (error) {
    return apiError(error);
  }
}

export const POST = withStore("POST", handlePOST);
