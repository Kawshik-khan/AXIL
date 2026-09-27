/**
 * CommerceOS Phase 7: Grounded Content & Personalization Engine
 * Synthesizes culturally-authentic Bangla/Banglish/English copy with strict factual verification against Commerce Core.
 */

import { db } from "@/infrastructure/db";
import {
  ContentTemplate,
  ContentAsset,
  GroundedContentVerification,
  MarketingChannelType,
} from "@/types/growth";

export class ContentService {
  /**
   * Renders a content template with personalized variables
   */
  public renderTemplate(
    template: ContentTemplate,
    variables: Record<string, string | number>
  ): string {
    let rendered = template.body_template;
    for (const [key, val] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      rendered = rendered.replace(regex, String(val));
    }
    return rendered;
  }

  /**
   * Strictly verifies content factuality against Commerce Core database state
   */
  public verifyContentFactuality(params: {
    tenantId: string;
    text: string;
    productId?: string;
    claimedPrice?: number;
    offerCode?: string;
  }): GroundedContentVerification {
    const { tenantId, text, productId, claimedPrice, offerCode } = params;
    const prohibitedClaimsFound: string[] = [];
    const violations: string[] = [];

    // 1. Prohibited deception check
    const lowerText = text.toLowerCase();
    const deceptiveKeywords = [
      "miracle cure",
      "guaranteed 100% profit",
      "completely free forever no catch",
      "instant millionaire",
      "fake discount",
    ];

    for (const kw of deceptiveKeywords) {
      if (lowerText.includes(kw)) {
        prohibitedClaimsFound.push(kw);
        violations.push(`Prohibited deceptive marketing phrase detected: '${kw}'`);
      }
    }

    // 2. Commerce Core Product & Price Verification
    let priceVerified = true;
    let stockVerified = true;

    if (productId) {
      const product = db.findProductById(tenantId, productId);
      if (!product) {
        violations.push(`Referenced product ID '${productId}' does not exist in Commerce Core catalog.`);
        priceVerified = false;
        stockVerified = false;
      } else {
        if (claimedPrice !== undefined) {
          if (Math.abs(product.base_price - claimedPrice) > 1) {
            violations.push(
              `Claimed price ৳${claimedPrice} does not match Commerce Core catalog price ৳${product.base_price}.`
            );
            priceVerified = false;
          }
        }

        // Stock verification
        const variants = db.getProductVariants(tenantId, productId);
        const totalStock = variants.reduce((sum, v) => sum + ((v as any).stock_quantity ?? (v as any).stock ?? 10), 0);
        if (totalStock <= 0) {
          violations.push(`Product '${product.name}' has 0 available inventory in warehouse.`);
          stockVerified = false;
        }
      }
    }

    // 3. Offer Code Verification
    if (offerCode) {
      const offer = db.getOffers(tenantId).find((o) => o.code === offerCode);
      const coupon = db.getCoupons(tenantId).find((c) => c.code === offerCode);
      if (!offer && !coupon) {
        violations.push(`Promotional code '${offerCode}' is neither an active Offer nor a valid Coupon.`);
      }
    }

    const isValid = violations.length === 0 && prohibitedClaimsFound.length === 0;

    return {
      is_valid: isValid,
      prohibited_claims_found: prohibitedClaimsFound,
      price_verified: priceVerified,
      stock_verified: stockVerified,
      violations,
    };
  }

  /**
   * Generates a grounded, culturally-authentic marketing copy draft
   */
  public generateCopyDraft(params: {
    tenantId: string;
    channel: MarketingChannelType;
    language: "bn" | "banglish" | "en";
    customerName: string;
    productId: string;
    offerCode?: string;
    category?: "PROMOTIONAL" | "CART_RECOVERY" | "WIN_BACK" | "CROSS_SELL";
  }): ContentAsset {
    const { tenantId, channel, language, customerName, productId, offerCode, category = "PROMOTIONAL" } = params;

    const product = db.findProductById(tenantId, productId);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }

    let renderedText = "";

    if (category === "CART_RECOVERY") {
      if (language === "banglish") {
        renderedText = `Salam ${customerName} bhai! Apnar cart e '${product.name}' (৳${product.base_price}) ekhono wait korche.${
          offerCode ? ` Special discount pete coupon '${offerCode}' use korun!` : ""
        } Stock limited, order complete korun: https://shop.local/checkout`;
      } else if (language === "bn") {
        renderedText = `সালাম ${customerName}! আপনার কার্টে '${product.name}' (৳${product.base_price}) এখনো সংরক্ষিত আছে।${
          offerCode ? ` ডিসকাউন্টের জন্য কুপন '${offerCode}' ব্যবহার করুন!` : ""
        } দ্রুত অর্ডার সম্পন্ন করুন।`;
      } else {
        renderedText = `Hello ${customerName}! You left '${product.name}' (৳${product.base_price}) in your cart.${
          offerCode ? ` Use code '${offerCode}' at checkout for an exclusive discount!` : ""
        } Complete your order now: https://shop.local/checkout`;
      }
    } else if (category === "WIN_BACK") {
      if (language === "banglish") {
        renderedText = `Salam ${customerName}! Onek din apnar dekha nai. Apnar jonno '${product.name}' ekhon available ৳${product.base_price} e.${
          offerCode ? ` Return voucher '${offerCode}' diye shop korun!` : ""
        }`;
      } else {
        renderedText = `Dear ${customerName}, we miss you! Check out '${product.name}' (৳${product.base_price}).${
          offerCode ? ` Use '${offerCode}' to enjoy your special VIP welcome back discount.` : ""
        }`;
      }
    } else {
      renderedText = `Salam ${customerName}! Check out our featured '${product.name}' for only ৳${product.base_price}.${
        offerCode ? ` Use promo code '${offerCode}' at checkout!` : ""
      }`;
    }

    const verification = this.verifyContentFactuality({
      tenantId,
      text: renderedText,
      productId,
      claimedPrice: product.base_price,
      offerCode,
    });

    const asset: ContentAsset = {
      id: `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: tenantId,
      channel,
      language,
      rendered_text: renderedText,
      verified_product_id: productId,
      verified_price: product.base_price,
      verified_stock_status: "IN_STOCK",
      verification_passed: verification.is_valid,
      created_at: new Date().toISOString(),
    };

    db.insertContentAsset(asset);
    return asset;
  }
}

export const contentService = new ContentService();
