import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { AgentPolicyService } from "@/domains/ai/policy/agent-policy.service";

const RATIO = z.number().finite().min(0).max(1);
// FX-12: policy fields only, with bounded limits and budgets.
const PolicyPatch = z
  .object({
    ai_mode: z.enum(["AI_AUTONOMOUS", "AI_COPILOT", "DISABLED"]),
    is_enabled: z.boolean(),
    autonomous_sales_enabled: z.boolean(),
    autonomous_support_enabled: z.boolean(),
    autonomous_order_enabled: z.boolean(),
    debounce_window_ms: z.number().int().min(0).max(60_000),
    confidence_threshold_high: RATIO,
    confidence_threshold_low: RATIO,
    max_iterations_per_run: z.number().int().min(1).max(50),
    max_tool_calls_per_run: z.number().int().min(0).max(100),
    max_tokens_per_run: z.number().int().min(1).max(200_000),
    daily_cost_budget_usd: z.number().finite().min(0).max(100_000),
    monthly_cost_budget_usd: z.number().finite().min(0).max(1_000_000),
    pii_redaction_enabled: z.boolean(),
    allowed_channel_types: z.array(z.string().max(40)).max(20),
    disallowed_tool_names: z.array(z.string().max(100)).max(200),
    human_handoff_reasons: z.array(z.string().max(200)).max(50),
  })
  .partial()
  .strict();

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_READ);

    const policy = await AgentPolicyService.getPolicy(context.tenant.id);
    return apiSuccess(policy);
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_CONFIGURE);

    const body = parseOrThrow(PolicyPatch, await readJson(request));
    const updated = await AgentPolicyService.updatePolicy(context, body);
    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}
