import { z } from "zod";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { PlatformAuditService } from "@/domains/platform/services/platform-audit.service";
import { db } from "@/infrastructure/db";
import { AiBudgetGuard } from "@/domains/ai/safety/budget-guard";
import { withStore } from "@/lib/store-unit";
import { NotFoundError } from "@/lib/errors";
import { PrivilegedActionGate } from "@/domains/platform/services/privileged-action-gate";

const UpdateBudgetBody = z
  .object({
    tenant_id: z.string().min(1),
    monthly_budget_usd: z.number().min(0).max(10000),
    hard_cap_action: z.enum(["FALLBACK_TO_RULES", "PAUSE_AND_ESCALATE"]).default("FALLBACK_TO_RULES"),
    // HIGH actions record why (rules/privileged-actions.md §2)
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "platform.read");

    const tenants = db.getTenants();
    const allSettings = db.getAllTenantAiGuardSettings();
    const settingsMap = new Map(allSettings.map((s) => [s.tenant_id, s]));
    const tenantMap = new Map(tenants.map((t: { id: string; name: string }) => [t.id, t.name]));
    const allTenantIds = Array.from(new Set([...tenants.map((t: { id: string }) => t.id), ...allSettings.map((s) => s.tenant_id)]));

    const budgets = allTenantIds.map((tenantId) => {
      const settings = settingsMap.get(tenantId) || AiBudgetGuard.getSettings(tenantId);
      const name = tenantMap.get(tenantId) || tenantId;
      const spend = Number((settings.current_month_spend_usd || 0).toFixed(2));
      const cap = Number((settings.monthly_budget_usd ?? 15.0).toFixed(2));
      const pct = cap > 0 ? Math.min(100, Math.round((spend / cap) * 100)) : 0;
      const softCap = settings.soft_cap_percent ?? 80;
      const hardCap = settings.hard_cap_percent ?? 100;
      const isNearLimit = pct >= softCap;
      const isHardCapExceeded = pct >= hardCap;

      return {
        tenant_id: tenantId,
        tenant_name: name,
        spend_usd: spend,
        cap_usd: cap,
        usage_pct: pct,
        hard_cap_action: (settings as any).hard_cap_action || "FALLBACK_TO_RULES",
        soft_cap_percent: softCap,
        hard_cap_percent: hardCap,
        is_near_limit: isNearLimit,
        is_hard_cap_exceeded: isHardCapExceeded,
        status: isHardCapExceeded ? "CAPPED" : isNearLimit ? "WARNING" : "NORMAL",
        updated_at: settings.updated_at,
      };
    });

    return apiSuccess({ budgets });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const body = UpdateBudgetBody.parse(await request.json());
    if (!db.findTenantById(body.tenant_id)) throw new NotFoundError("Tenant not found.");
    // HIGH: permission, step-up and reason through the shared gate (security review M6)
    PrivilegedActionGate.assert(context, "ai.budget.update", {
      reason: body.reason,
      payload: { tenant: body.tenant_id, monthly_budget_usd: body.monthly_budget_usd, hard_cap_action: body.hard_cap_action },
    });

    const current = AiBudgetGuard.getSettings(body.tenant_id);
    const updated = {
      ...current,
      monthly_budget_usd: body.monthly_budget_usd,
      hard_cap_action: body.hard_cap_action,
      hard_cap_percent: 100,
      soft_cap_percent: 80,
      updated_at: new Date().toISOString(),
    };

    const saved = db.saveTenantAiGuardSettings(updated);

    PlatformAuditService.record(
      {
        action: "platform.ai.budget.update",
        resource_type: "ai_guard_settings",
        resource_id: body.tenant_id,
        target_tenant_id: body.tenant_id,
        reason: body.reason,
        result: "SUCCESS",
        before_state: { monthly_budget_usd: current.monthly_budget_usd, hard_cap_action: (current as any).hard_cap_action },
        after_state: { monthly_budget_usd: body.monthly_budget_usd, hard_cap_action: body.hard_cap_action },
      },
      context
    );

    return apiSuccess(saved);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);

