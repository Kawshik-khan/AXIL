import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseAiGovernanceService } from "@/domains/enterprise/services/enterprise-ai-governance.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.GOVERNANCE_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const storeId = searchParams.get("store_id") || undefined;

    const budget = db.getEnterpriseAIBudget(orgId, storeId);
    const usage = db.getAIUsageRecords(orgId);

    return apiSuccess({
      budget,
      total_records: usage.length,
      usage: usage.slice(0, 20),
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.GOVERNANCE_MANAGE);
    const body = await request.json();
    const orgId = resolveOrganizationId(context, body.organization_id);

    const budget = enterpriseAiGovernanceService.setBudget({
      organizationId: orgId,
      entityType: body.store_id ? "STORE" : "ORGANIZATION",
      entityId: body.store_id || orgId,
      monthlyBudgetUsd: body.monthly_budget_usd || 100,
      maxTokensPerMonth: body.token_limit_month || body.max_tokens_per_month || 5000000,
      allowedModels: body.allowed_models,
      blockedTools: body.blocked_tools,
    });

    return apiSuccess(budget, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
