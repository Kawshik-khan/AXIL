import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { withStore } from "@/lib/store-unit";
import { parseOrThrow, readJson } from "@/lib/validation";
import { AdvanceFeeService } from "@/domains/rto/advance-fee.service";

const RequestBody = z
  .object({
    order_id: z.string().min(1),
    amount_bdt: z.number().positive().max(1000).optional(),
    channel: z.enum(["SMS", "WHATSAPP"]).optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const ctx = await extractRequestContext(request);
    RbacService.assertCan(ctx, PERMISSIONS.ORDERS_WRITE);

    const input = parseOrThrow(RequestBody, await readJson(request));
    const result = await AdvanceFeeService.requestAdvanceFee(ctx, input.order_id, {
      amount_bdt: input.amount_bdt,
      channel: input.channel,
    });

    return apiSuccess(result, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
