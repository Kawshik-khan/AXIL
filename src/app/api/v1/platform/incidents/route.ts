import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformIncidentService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const incidents = PlatformIncidentService.listIncidents(context);
    return apiSuccess(incidents);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const incident = PlatformIncidentService.declareIncident(body, context);
    return apiSuccess(incident, undefined, 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = await request.json();
    const { id, status, notes } = body;
    const updated = PlatformIncidentService.updateIncidentStatus(id, status, notes, context);
    return apiSuccess(updated);
  } catch (error) {
    return apiError(error);
  }
}
