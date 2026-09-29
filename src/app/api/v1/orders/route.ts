import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { OrderService } from "@/domains/orders/order.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status") || undefined;
    const payment_status = searchParams.get("payment_status") || undefined;
    const customer_id = searchParams.get("customer_id") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const result = await OrderService.listOrders(context, {
      status,
      payment_status,
      customer_id,
      search,
      limit,
      offset,
    });

    return apiSuccess(result.orders, { total: result.total });
  } catch (err) {
    return apiError(err);
  }
}

const Address = z
  .object({
    division: z.string().optional(),
    district: z.string().trim().min(1),
    upazila: z.string().optional(),
    area: z.string().optional(),
    address_line_1: z.string().trim().min(1),
    postal_code: z.string().optional(),
  })
  .strict();

/** Strict order body: whole positive quantities, known payment methods, a district (FX-35 step 5, FX-36 M5). */
const CreateOrderBody = z
  .object({
    customer: z
      .object({
        first_name: z.string().trim().min(1),
        last_name: z.string().trim().default(""),
        phone: z.string().trim().min(6),
        email: z.string().email().optional(),
      })
      .strict(),
    delivery_address: Address,
    delivery_zone: z.enum(["INSIDE_DHAKA", "OUTSIDE_DHAKA"]).optional(), // derived from the district on the server
    items: z.array(z.object({ variant_id: z.string().min(1), quantity: z.number().int().positive() }).strict()).min(1),
    payment_method: z.enum(["COD", "BKASH", "NAGAD", "ROCKET", "CARD"]),
    coupon_code: z.string().trim().min(1).optional(),
    notes: z.string().max(2000).optional(),
    warehouse_id: z.string().optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = CreateOrderBody.parse(await request.json());

    const order = await OrderService.createOrder(context, body);
    return apiSuccess({ order }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
