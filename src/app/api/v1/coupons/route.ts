import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CouponService } from "@/domains/promotions/coupon.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const coupons = await CouponService.listCoupons(context);
    return apiSuccess({ coupons });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const coupon = await CouponService.createCoupon(context, body);
    return apiSuccess({ coupon }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
