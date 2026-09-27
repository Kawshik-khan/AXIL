import { db } from "@/infrastructure/db";
import { CouponService } from "@/domains/promotions/coupon.service";
import { BadRequestError } from "@/lib/errors";

export interface PricingCalculationResult {
  items: Array<{
    product_id: string;
    variant_id: string;
    product_name_snapshot: string;
    sku_snapshot: string;
    unit_price: number;
    quantity: number;
    discount: number;
    tax: number;
    line_total: number;
  }>;
  subtotal: number;
  discount_total: number;
  shipping_total: number;
  tax_total: number;
  grand_total: number;
  applied_coupon?: string;
}

export class PricingService {
  /**
   * Authoritative server-side price calculation.
   * Client-provided totals are NEVER trusted.
   */
  public static async calculateOrderPricing(
    tenantId: string,
    items: Array<{ variant_id: string; quantity: number }>,
    deliveryZone: "INSIDE_DHAKA" | "OUTSIDE_DHAKA",
    couponCode?: string
  ): Promise<PricingCalculationResult> {
    if (!items || items.length === 0) {
      throw new BadRequestError("Cannot calculate pricing for an empty order item list.");
    }

    const tenant = db.findTenantById(tenantId);
    const settings = (tenant?.settings || {}) as Record<string, any>;
    const insideDhakaFee = typeof settings.delivery_charge_inside_dhaka === "number" ? settings.delivery_charge_inside_dhaka : 60;
    const outsideDhakaFee = typeof settings.delivery_charge_outside_dhaka === "number" ? settings.delivery_charge_outside_dhaka : 120;
    const shippingTotal = deliveryZone === "INSIDE_DHAKA" ? insideDhakaFee : outsideDhakaFee;

    let subtotal = 0;
    const computedItems: PricingCalculationResult["items"] = [];

    for (const item of items) {
      if (!item.variant_id || item.quantity <= 0) {
        throw new BadRequestError("Each item must have a valid variant ID and positive quantity.");
      }

      const variant = db.findVariantById(tenantId, item.variant_id);
      if (!variant) {
        throw new BadRequestError(`Product variant '${item.variant_id}' does not exist.`);
      }

      const product = db.findProductById(tenantId, variant.product_id);
      if (!product || product.status === "ARCHIVED") {
        throw new BadRequestError(`Product '${variant.product_id}' is unavailable.`);
      }

      const unitPrice = variant.price;
      const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
      subtotal += lineTotal;

      computedItems.push({
        product_id: product.id,
        variant_id: variant.id,
        product_name_snapshot: `${product.name} (${variant.title})`,
        sku_snapshot: variant.sku,
        unit_price: unitPrice,
        quantity: item.quantity,
        discount: 0,
        tax: 0,
        line_total: lineTotal,
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    let discountTotal = 0;
    let appliedCoupon: string | undefined;

    if (couponCode && couponCode.trim().length > 0) {
      const couponResult = await CouponService.validateAndCalculateDiscount(
        tenantId,
        couponCode,
        subtotal
      );
      discountTotal = couponResult.discount;
      appliedCoupon = couponResult.coupon.code;
    }

    const taxTotal = 0; // Configurable future tax expansion
    const grandTotal = Math.max(0, Math.round((subtotal - discountTotal + shippingTotal + taxTotal) * 100) / 100);

    return {
      items: computedItems,
      subtotal,
      discount_total: discountTotal,
      shipping_total: shippingTotal,
      tax_total: taxTotal,
      grand_total: grandTotal,
      applied_coupon: appliedCoupon,
    };
  }
}
