import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const { id } = await params;
    const campaign = db.getCampaignById(id);
    if (!campaign || campaign.tenant_id !== context.tenant.id) {
      return apiError(new Error("Campaign not found"));
    }
    return apiSuccess({ campaign });
  } catch (err) {
    return apiError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const body = await request.json();

    const campaign = db.getCampaignById(id);
    if (!campaign || campaign.tenant_id !== context.tenant.id) {
      return apiError(new Error("Campaign not found"));
    }

    const updated = db.updateCampaign(id, body);
    return apiSuccess({ campaign: updated });
  } catch (err) {
    return apiError(err);
  }
}
