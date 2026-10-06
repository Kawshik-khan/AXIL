import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { ShadowRatingService } from "@/domains/ai/customer-agent/shadow-rating.service";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ rating: z.enum(["USABLE", "NOT_USABLE"]), note: z.string().trim().max(300).optional() }).strict();

/** Rates the agent's shadow draft on this conversation (FX-87 shadow week). */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_MESSAGE_SEND);
    const { rating, note } = parseOrThrow(Body, await readJson(request));
    return apiSuccess(ShadowRatingService.rate(context, (await params).id, rating, note));
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
