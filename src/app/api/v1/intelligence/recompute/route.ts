import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceRecomputeService } from "@/domains/intelligence/services/intelligence-recompute.service";

/**
 * Recomputes and stores every intelligence snapshot for the caller's workspace (FX-21). Intelligence GETs never
 * write; they serve the snapshot this stores while it is fresh (15 minutes) and compute in memory otherwise.
 */
export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_MANAGE);
    const summary = intelligenceRecomputeService.recomputeAll(context.tenant.id);
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "INTELLIGENCE_RECOMPUTED",
      resourceType: "intelligence",
      resourceId: context.tenant.id,
      metadata: { duration_ms: summary.duration_ms, kinds: summary.kinds.map((k) => `${k.kind}:${k.rows}`) },
    });
    return apiSuccess(summary);
  } catch (err) {
    return apiError(err);
  }
}
