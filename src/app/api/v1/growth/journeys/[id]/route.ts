import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const journey = db.getJourneyById(id);
    if (!journey || journey.tenant_id !== context.tenant.id) {
      return apiError(new Error("Journey not found"));
    }
    const enrollments = db.getJourneyEnrollments(context.tenant.id, id);
    return apiSuccess({ journey, enrollments });
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

    const journey = db.getJourneyById(id);
    if (!journey || journey.tenant_id !== context.tenant.id) {
      return apiError(new Error("Journey not found"));
    }

    const updated = db.updateJourney(id, body);
    return apiSuccess({ journey: updated });
  } catch (err) {
    return apiError(err);
  }
}
