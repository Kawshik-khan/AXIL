import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentSettingsService, PaymentSettingsUpdateSchema } from "@/domains/payments/payment-settings.service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { parseOrThrow, readJson } from "@/lib/validation";
import { requireStepUp } from "@/lib/step-up";
import { withStore } from "@/lib/store-unit";

/** How this shop gets paid: manual wallet numbers and its own gateway accounts (credentials are never returned). */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    return apiSuccess({ settings: PaymentSettingsService.get(context) });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePUT(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const input = parseOrThrow(PaymentSettingsUpdateSchema, await readJson(request));
    // Changing where customers' money goes: a fresh authenticator code once step-up is enforced (FX-97)
    await requireStepUp(context, "CHANGE_PAYMENT_SETTINGS");
    return apiSuccess({ settings: PaymentSettingsService.update(context, input) });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const PUT = withStore("PUT", handlePUT);
