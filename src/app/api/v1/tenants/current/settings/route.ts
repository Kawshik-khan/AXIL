import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { TenantService } from "@/domains/tenants/service";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";

// FX-12: only these workspace fields and known settings keys can change (audit H4).
const SettingsPatch = z
  .object({
    name: z.string().trim().min(1).max(120),
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1).max(64),
    language: z.string().min(2).max(10),
    settings: z
      .object({
        delivery_charge_inside_dhaka: z.number().finite().min(0).max(100_000),
        delivery_charge_outside_dhaka: z.number().finite().min(0).max(100_000),
        allow_overselling: z.boolean(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

async function handlePATCH(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);

    const body = parseOrThrow(SettingsPatch, await readJson(request));
    const updated = TenantService.updateTenantSettings(context.tenant.id, body);

    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "SETTINGS_UPDATED",
      resourceType: "tenant",
      resourceId: context.tenant.id,
      metadata: body,
    });

    return apiSuccess({ tenant: updated });
  } catch (err) {
    return apiError(err);
  }
}

export const PATCH = withStore("PATCH", handlePATCH);
