import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { audienceService } from "@/domains/growth/services/audience.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const snapshot = audienceService.createAudienceSnapshot(context.tenant.id, id);
    return apiSuccess({ snapshot, member_count: snapshot.member_count });
  } catch (err) {
    return apiError(err);
  }
}
