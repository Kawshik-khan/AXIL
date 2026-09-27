import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { audienceService } from "@/domains/growth/services/audience.service";
import { db } from "@/infrastructure/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const audience = audienceService.getAudience(context.tenant.id, id);
    if (!audience) {
      return apiError(new Error("Audience not found"));
    }
    return apiSuccess({ audience });
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
    const { id } = await params;
    const body = await request.json();

    const existing = audienceService.getAudience(context.tenant.id, id);
    if (!existing) {
      return apiError(new Error("Audience not found"));
    }

    const updated = db.updateAudience(id, body);
    return apiSuccess({ audience: updated });
  } catch (err) {
    return apiError(err);
  }
}
