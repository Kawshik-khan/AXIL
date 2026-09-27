import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const result = await marketingService.dispatchBroadcast(context.tenant.id, params.id);
    return apiSuccess({ result });
  } catch (err) {
    return apiError(err);
  }
}
