import { parseOrThrow, readJson } from "@/lib/validation";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { TenantService } from "@/domains/tenants/service";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import {
  DEFAULT_PRODUCT_CARD_SETTINGS,
  ProductCardSettingsSchema,
  getProductCardSettings,
} from "@/domains/social/outbound/product-card-settings";

/**
 * The shop's product-card template: GET (settings.read) returns it, or the defaults without storing them; PUT
 * (settings.update) replaces it with a complete, strictly validated template.
 */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    return apiSuccess({ settings: getProductCardSettings(context.tenant.id), defaults: DEFAULT_PRODUCT_CARD_SETTINGS });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePUT(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const settings = parseOrThrow(ProductCardSettingsSchema, await readJson(request));
    const before = getProductCardSettings(context.tenant.id);
    TenantService.updateTenantSettings(context.tenant.id, { settings: { product_cards: settings } });
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "PRODUCT_CARD_SETTINGS_UPDATED",
      resourceType: "tenant",
      resourceId: context.tenant.id,
      metadata: { before, after: settings },
    });
    return apiSuccess({ settings });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PUT = withStore("PUT", handlePUT);
