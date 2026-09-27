import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { journeyEngineService } from "@/domains/growth/services/journey-engine.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const journeys = db.getJourneys(context.tenant.id);
    return apiSuccess({ journeys, total: journeys.length });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const journey = journeyEngineService.createJourney({
      tenantId: context.tenant.id,
      name: body.name,
      description: body.description || "",
      triggerEvent: body.trigger_event,
      steps: body.steps || [],
    });

    return apiSuccess({ journey }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
