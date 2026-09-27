import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { exceptionManagementService } from "@/domains/operations/services/exception-management.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const exceptionId = params.id;
    const body = await request.json();

    const resolved = exceptionManagementService.resolveException(
      tenantId,
      exceptionId,
      body.resolution_notes || "Resolved by operator via control plane.",
      context.user.id
    );

    return apiSuccess(resolved);
  } catch (err) {
    return apiError(err);
  }
}
