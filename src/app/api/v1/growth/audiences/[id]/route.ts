import { z } from "zod";
import type { Audience } from "@/types/growth";
import { parseOrThrow, readJson } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { audienceService } from "@/domains/growth/services/audience.service";
import { db } from "@/infrastructure/db";

// FX-12: status, size and ownership are computed server-side, never taken from the body.
const AudiencePatch = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000),
    rule_groups: z.array(z.record(z.unknown())).max(50),
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
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const body = parseOrThrow(AudiencePatch, await readJson(request)) as Partial<Audience>;

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
