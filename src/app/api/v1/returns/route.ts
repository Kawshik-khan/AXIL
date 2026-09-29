import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { ReturnService } from "@/domains/returns/return.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const returns = await ReturnService.listReturns(context);
    return apiSuccess({ returns });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const returnRequest = await ReturnService.requestReturn(context, body);
    return apiSuccess({ return: returnRequest }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
