import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentLinkCreateSchema, PaymentLinkService } from "@/domains/payments/payment-link.service";
import { parseOrThrow, readJson } from "@/lib/validation";
import { withStore } from "@/lib/store-unit";

/** Payment links of this shop, newest first; `?order_id=` narrows to one order. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const orderId = new URL(request.url).searchParams.get("order_id") || undefined;
    return apiSuccess({ links: PaymentLinkService.list(context, orderId) });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const input = parseOrThrow(PaymentLinkCreateSchema, await readJson(request));
    return apiSuccess({ link: await PaymentLinkService.create(context, input) }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
