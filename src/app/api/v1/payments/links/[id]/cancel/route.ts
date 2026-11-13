import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PaymentLinkService } from "@/domains/payments/payment-link.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    return apiSuccess({ link: PaymentLinkService.cancel(context, id) });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
