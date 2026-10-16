import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { AiBudgetGuard } from "@/domains/ai/safety/budget-guard";
import { db } from "@/infrastructure/db";

const PatchSettingsBody = z
  .object({
    is_guard_enabled: z.boolean().optional(),
    monthly_budget_usd: z.number().positive().max(500).optional(),
    soft_cap_percent: z.number().min(50).max(95).optional(),
    hard_cap_percent: z.number().min(95).max(150).optional(),
    confidence_escalation_threshold: z.number().min(50).max(95).optional(),
    high_value_cod_threshold_bdt: z.number().min(1000).max(50000).optional(),
    block_adversarial_jailbreaks: z.boolean().optional(),
    auto_pause_bot_on_human_message: z.boolean().optional(),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);

    const settings = AiBudgetGuard.getSettings(context.tenant.id);
    return apiSuccess(settings);
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);

    const body = PatchSettingsBody.parse(await request.json());
    const existing = AiBudgetGuard.getSettings(context.tenant.id);

    const updated = db.saveTenantAiGuardSettings({
      ...existing,
      ...body,
      updated_at: new Date().toISOString(),
    });

    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
