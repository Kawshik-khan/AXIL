import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_ANALYTICS_READ);

    const { searchParams } = new URL(request.url);
    const agent_type = searchParams.get("agent_type") || undefined;
    const since = searchParams.get("since") || undefined;

    const records = db.getAIUsage(context.tenant.id, { agent_type, since });

    const total_prompt_tokens = records.reduce((s, r) => s + r.prompt_tokens, 0);
    const total_completion_tokens = records.reduce((s, r) => s + r.completion_tokens, 0);
    const total_tokens = total_prompt_tokens + total_completion_tokens;
    const total_cost_usd = records.reduce((s, r) => s + (r.estimated_cost_usd || 0), 0);
    const total_cost_bdt = records.reduce((s, r) => s + (r.estimated_cost_bdt || 0), 0);

    return apiSuccess({
      summary: {
        total_records: records.length,
        total_prompt_tokens,
        total_completion_tokens,
        total_tokens,
        total_cost_usd: Math.round(total_cost_usd * 10000) / 10000,
        total_cost_bdt: Math.round(total_cost_bdt * 100) / 100,
      },
      records,
    });
  } catch (err) {
    return apiError(err);
  }
}
