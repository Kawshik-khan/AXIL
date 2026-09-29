import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { analyticsService } from "@/domains/analytics/analytics.service";
import { NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const digest = await analyticsService.getExecutiveDigestById(context, id);

    if (!digest) {
      throw new NotFoundError(`Executive digest '${id}' not found.`);
    }

    return apiSuccess({ digest });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
