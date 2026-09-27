import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { autonomousControlPlaneService } from "@/domains/autonomous/services";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const overview = autonomousControlPlaneService.getAutonomousOverview(context.tenant.id);
    return apiSuccess(overview);
  } catch (err) {
    return apiError(err);
  }
}
