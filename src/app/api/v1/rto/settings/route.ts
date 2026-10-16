import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { db } from "@/infrastructure/db";
import { TenantRtoSettingsRecord } from "@/types/rto";

const PatchSettingsBody = z
  .object({
    is_enabled: z.boolean().optional(),
    auto_advance_fee_threshold: z.number().min(20).max(95).optional(),
    advance_fee_amount_bdt: z.number().min(30).max(500).optional(),
    auto_cancel_unpaid_hours: z.number().min(1).max(72).optional(),
    enable_courier_fake_attempt_check: z.boolean().optional(),
    exempt_returning_customers: z.boolean().optional(),
  })
  .strict();

async function handleGET(request: Request) {
  try {
    const ctx = await extractRequestContext(request);
    RbacService.assertCan(ctx, PERMISSIONS.SETTINGS_READ);

    const settings =
      db.getTenantRtoSettings(ctx.tenant.id) || {
        tenant_id: ctx.tenant.id,
        is_enabled: true,
        auto_advance_fee_threshold: 55,
        advance_fee_amount_bdt: 120,
        auto_cancel_unpaid_hours: 24,
        enable_courier_fake_attempt_check: true,
        exempt_returning_customers: true,
        updated_at: new Date().toISOString(),
      };

    return apiSuccess(settings);
  } catch (err) {
    return apiError(err);
  }
}

async function handlePATCH(request: Request) {
  try {
    const ctx = await extractRequestContext(request);
    RbacService.assertCan(ctx, PERMISSIONS.SETTINGS_UPDATE);

    const patch = parseOrThrow(PatchSettingsBody, await readJson(request));
    const existing =
      db.getTenantRtoSettings(ctx.tenant.id) || {
        tenant_id: ctx.tenant.id,
        is_enabled: true,
        auto_advance_fee_threshold: 55,
        advance_fee_amount_bdt: 120,
        auto_cancel_unpaid_hours: 24,
        enable_courier_fake_attempt_check: true,
        exempt_returning_customers: true,
        updated_at: new Date().toISOString(),
      };

    const updated: TenantRtoSettingsRecord = {
      ...existing,
      ...patch,
      tenant_id: ctx.tenant.id,
      updated_at: new Date().toISOString(),
    };

    db.saveTenantRtoSettings(updated);

    return apiSuccess(updated);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PATCH = withStore("PATCH", handlePATCH);
