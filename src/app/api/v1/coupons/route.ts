import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { CouponService } from "@/domains/promotions/coupon.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const coupons = await CouponService.listCoupons(context);
    return apiSuccess({ coupons });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();

    const coupon = await CouponService.createCoupon(context, body);
    return apiSuccess({ coupon }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
