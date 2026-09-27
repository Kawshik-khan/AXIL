import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { exceptionManagementService } from "@/domains/operations/services/exception-management.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const { searchParams } = new URL(request.url);

    const domain = searchParams.get("domain");
    const severity = searchParams.get("severity");
    const status = searchParams.get("status");

    let exceptions = db.getOperationalExceptions(tenantId);
    if (domain) exceptions = exceptions.filter((e) => e.domain === domain);
    if (severity) exceptions = exceptions.filter((e) => e.severity === severity);
    if (status) exceptions = exceptions.filter((e) => e.status === status);

    return apiSuccess({
      total: exceptions.length,
      exceptions,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const body = await request.json();

    const created = exceptionManagementService.createException(tenantId, {
      domain: body.domain,
      exceptionType: body.exception_type,
      severity: body.severity || "MEDIUM",
      title: body.title,
      description: body.description,
      entityType: body.entity_type,
      entityId: body.entity_id,
      evidence: body.evidence || {},
      rootCauseHypothesis: body.root_cause_hypothesis,
      proposedAction: body.proposed_action,
    });

    return apiSuccess(created);
  } catch (err) {
    return apiError(err);
  }
}
