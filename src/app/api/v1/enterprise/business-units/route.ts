import { z } from "zod";
import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { enterpriseDataAccessService } from "@/domains/enterprise/services/enterprise-data-access.service";
import { db } from "@/infrastructure/db";

/** Lists only the business units in the caller's enterprise scope (N13). */
export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BUSINESS_UNIT_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const units = enterpriseDataAccessService.getAuthorizedBusinessUnits(resolveEnterpriseCaller(context, orgId));
    return apiSuccess({ total: units.length, business_units: units });
  } catch (err) {
    return apiError(err);
  }
}

const CreateBusinessUnit = z
  .object({
    organization_id: z.string().optional(),
    name: z.string().trim().min(1),
    code: z.string().trim().min(1),
    description: z.string().optional(),
    budget_allocated_bdt: z.number().nonnegative().optional(),
  })
  .strict();

/** A business unit is organization-level structure: only organization-wide callers create one (N13). */
export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.BUSINESS_UNIT_MANAGE);
    const body = CreateBusinessUnit.parse(await request.json());
    const orgId = resolveOrganizationId(context, body.organization_id);
    if (!resolveEnterpriseCaller(context, orgId).assigned_scope.all_access) {
      throw new ForbiddenError("Creating a business unit needs organization-wide enterprise scope");
    }
    const created = enterpriseHierarchyService.createBusinessUnit(orgId, {
      name: body.name,
      code: body.code,
      description: body.description,
      budget_allocated_bdt: body.budget_allocated_bdt,
    });
    return apiSuccess(created, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
