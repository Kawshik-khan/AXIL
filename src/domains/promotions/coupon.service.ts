import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { Coupon } from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export class CouponService {
  public static async listCoupons(context: RequestContext): Promise<Coupon[]> {
    RbacService.assertCan(context, PERMISSIONS.COUPONS_READ);
    return db.getCoupons(context.tenant.id);
  }

  public static async createCoupon(
    context: RequestContext,
    payload: {
      code: string;
      type: "PERCENTAGE" | "FIXED";
      value: number;
      minimum_order_value?: number;
      maximum_discount?: number;
      usage_limit?: number;
      expires_at?: string;
    }
  ): Promise<Coupon> {
    RbacService.assertCan(context, PERMISSIONS.COUPONS_MANAGE);

    if (!payload.code || payload.code.trim().length === 0) {
      throw new BadRequestError("Coupon code is required.");
    }
    if (typeof payload.value !== "number" || payload.value <= 0) {
      throw new BadRequestError("Valid coupon discount value is required.");
    }

    const normalizedCode = payload.code.trim().toUpperCase();
    const existing = db.findCouponByCode(context.tenant.id, normalizedCode);
    if (existing) {
      throw new BadRequestError(`Coupon code '${normalizedCode}' already exists.`);
    }

    const newCoupon: Coupon = {
      id: `cpn_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      code: normalizedCode,
      type: payload.type,
      value: payload.value,
      minimum_order_value: payload.minimum_order_value,
      maximum_discount: payload.maximum_discount,
      usage_limit: payload.usage_limit,
      usage_count: 0,
      expires_at: payload.expires_at,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
    };

    return db.createCoupon(newCoupon);
  }

  public static async validateAndCalculateDiscount(
    tenantId: string,
    code: string,
    subtotal: number
  ): Promise<{ discount: number; coupon: Coupon }> {
    const normalized = code.trim().toUpperCase();
    const coupon = db.findCouponByCode(tenantId, normalized);

    if (!coupon || coupon.status !== "ACTIVE") {
      throw new BadRequestError(`Coupon '${code}' is invalid or inactive.`);
    }

    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
      throw new BadRequestError(`Coupon '${code}' has expired.`);
    }

    if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
      throw new BadRequestError(`Coupon '${code}' usage limit has been reached.`);
    }

    if (coupon.minimum_order_value && subtotal < coupon.minimum_order_value) {
      throw new BadRequestError(
        `Order subtotal (${subtotal} ৳) does not meet the minimum requirement of ${coupon.minimum_order_value} ৳ for coupon '${code}'.`
      );
    }

    let discount = 0;
    if (coupon.type === "PERCENTAGE") {
      discount = (subtotal * coupon.value) / 100;
      if (coupon.maximum_discount && discount > coupon.maximum_discount) {
        discount = coupon.maximum_discount;
      }
    } else {
      discount = Math.min(coupon.value, subtotal);
    }

    return {
      discount: Math.round(discount * 100) / 100,
      coupon,
    };
  }
}
