import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { campaignService } from "@/domains/growth/services/campaign.service";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

const VARIANT = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().max(200),
    subject_or_title: z.string().max(500),
    content_body: z.string().max(5000),
    call_to_action: z.string().max(500),
    offer_id: z.string().max(100).optional(),
    allocation_pct: z.number().min(0).max(100),
  })
  .strict();

// FX-12: content and targeting only. Status, approval and risk fields are rejected (a DRAFT could otherwise be set
// straight to APPROVED, skipping MARKETING_APPROVE and the four-eyes rule).
const CampaignPatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    objective: z.enum(["AWARENESS", "ENGAGEMENT", "CONVERSION", "RETENTION", "REACTIVATION", "UPSELL", "CROSS_SELL", "CUSTOMER_SERVICE"]),
    audience_id: z.string().min(1).max(100),
    channel: z.enum(["WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM", "WEBSITE_CHAT", "EMAIL", "TELEGRAM"]),
    variants: z.array(VARIANT).max(10),
    offer_id: z.string().max(100).nullable(),
    target_products: z.array(z.string().max(100)).max(200),
    budget_bdt: z.number().finite().min(0).max(100_000_000),
    scheduled_start_at: z.string().datetime().nullable(),
    scheduled_end_at: z.string().datetime().nullable(),
  })
  .partial()
  .strict();

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const { id } = await params;
    const campaign = db.getCampaignById(context.tenant.id, id);
    if (!campaign || campaign.tenant_id !== context.tenant.id) {
      return apiError(new Error("Campaign not found"));
    }
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const patch = parseOrThrow(CampaignPatch, await readJson(request));
    const campaign = campaignService.updateDraftCampaign(context.tenant.id, id, patch);
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PUT = withStore("PUT", handlePUT);
