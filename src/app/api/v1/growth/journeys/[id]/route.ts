import { z } from "zod";
import type { CustomerJourney } from "@/types/growth";
import { parseOrThrow, readJson } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";

// FX-12: status changes go through the pause/resume routes; counters are server-side.
const JourneyPatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    trigger_event: z.string().trim().min(1).max(100),
    steps: z.array(z.record(z.unknown())).max(100),
  })
  .partial()
  .strict();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
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
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const body = parseOrThrow(JourneyPatch, await readJson(request)) as Partial<CustomerJourney>;

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
