import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { journeyEngineService } from "@/domains/growth/services/journey-engine.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const journey = journeyEngineService.pauseJourney(context.tenant.id, id);
    return apiSuccess({ journey });
  } catch (err) {
    return apiError(err);
  }
}
