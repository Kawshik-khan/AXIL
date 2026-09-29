import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { db } from "@/infrastructure/db";
import { recommendationService } from "@/domains/intelligence/services/recommendation.service";
import { RecommendationStatus } from "@/types/intelligence";
import { withStore } from "@/lib/store-unit";

/**
 * Read-only (FX-21). Without `status`: the current recommendations (stored snapshot while fresh, otherwise computed,
 * with decisions already made carried over). With `status`: every stored recommendation in that state (history).
 */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const tenantId = context.tenant.id;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as RecommendationStatus | null;
    if (status) {
      const recommendations = db.getRecommendations(tenantId, status);
      return apiSuccess({ recommendations, total: recommendations.length });
    }
    const { rows, snapshot } = intelligenceSnapshots.read(tenantId, "recommendations", () =>
      recommendationService.computeRecommendations(tenantId)
    );
    return apiSuccess({ recommendations: rows, total: rows.length }, { snapshot });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
