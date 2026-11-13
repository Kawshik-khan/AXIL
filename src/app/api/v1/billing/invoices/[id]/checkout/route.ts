import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { GatewayPaymentService } from "@/domains/payments/gateway-payment.service";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

const Body = z
  .object({
    provider: z.enum(["SSLCOMMERZ", "BKASH"]),
    /** The payer's mobile number: gateways require one, and bKash pre-fills it. */
    phone: z.string().trim().regex(/^01[3-9]\d{8}$/, "Enter an 11-digit mobile number starting with 01."),
  })
  .strict();

/** Starts an online payment of this workspace's invoice through the platform's own gateway account. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    await enforceRateLimit(`billing:checkout:${context.tenant.id}`, 6, MINUTE);
    const { id } = await params;
    const input = parseOrThrow(Body, await readJson(request));
    return apiSuccess(await GatewayPaymentService.startInvoiceCheckout(context, id, input));
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST, { unit: false }); // calls the gateway: never under the store lock
