/**
 * New-shop onboarding: where the owner is in the setup steps, the answers it collects (shop name, language, what the
 * shop sells, delivery charges) and the launch checklist shown on the dashboard afterwards.
 *
 * Progress lives in tenant.settings.onboarding. Only workspaces created by self-registration get it (AuthService),
 * so shops that existed before onboarding are never sent through it. Every checklist item is computed from the
 * workspace's real data on each read; nothing is ticked by hand.
 */
import { z } from "zod";
import { db } from "@/infrastructure/db";
import type { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { TenantService } from "@/domains/tenants/service";
import { PricingService } from "@/domains/pricing/pricing.service";
import { AuditService } from "@/domains/audit/service";
import { productRepository } from "@/domains/catalog/product.repository";
import { orderRepository } from "@/domains/orders/order.repository";
import { AppError } from "@/lib/errors";

export const ONBOARDING_STEPS = ["welcome", "shop", "delivery", "try", "plan"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const BUSINESS_CATEGORIES = ["CLOTHING", "COSMETICS", "FOOD", "GADGETS", "HANDMADE", "OTHER"] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

/** The languages the customer assistant answers in (tenant.language, read by the customer agent). */
export const SHOP_LANGUAGES = ["bn", "en"] as const;

interface OnboardingState {
  step: OnboardingStep;
  started_at: string;
  completed_at: string | null;
  checklist_dismissed_at: string | null;
  /** Set when the owner chose to stay on Free (no subscription is created for that). */
  free_plan_chosen_at: string | null;
}

export const OnboardingUpdateSchema = z
  .object({
    step: z.enum(ONBOARDING_STEPS),
    /** Finishes onboarding; the dashboard shows the launch checklist from then on. */
    complete: z.literal(true),
    /** Hides the launch checklist card for good. */
    dismiss_checklist: z.literal(true),
    /** The owner chose to stay on the Free plan. */
    choose_free_plan: z.literal(true),
    language: z.enum(SHOP_LANGUAGES),
    shop_name: z.string().trim().min(2, "Enter at least 2 characters.").max(120),
    business_category: z.enum(BUSINESS_CATEGORIES),
    delivery_charge_inside_dhaka: z.number().finite().min(0).max(100_000),
    delivery_charge_outside_dhaka: z.number().finite().min(0).max(100_000),
  })
  .partial()
  .strict();

export type OnboardingUpdate = z.infer<typeof OnboardingUpdateSchema>;

export interface ChecklistItem {
  id: "shop" | "delivery" | "payments" | "product" | "channel" | "plan" | "first_order";
  label: string;
  hint: string;
  done: boolean;
  /** Where in the app the owner finishes this item. */
  href: string;
}

export interface OnboardingStatus {
  /** null for a workspace that never went through onboarding (it existed before it): no prompts, no checklist. */
  state: OnboardingState | null;
  /** True while a self-registered workspace has not finished the setup steps. */
  needs_onboarding: boolean;
  /** True when the launch checklist card should show: onboarding started, items left, not dismissed. */
  show_checklist: boolean;
  profile: {
    shop_name: string;
    language: string;
    business_category: BusinessCategory | null;
    delivery_fees: { inside_dhaka_bdt: number; outside_dhaka_bdt: number };
    /** Whether the owner has set the delivery charges (else the code defaults apply). */
    delivery_fees_set: boolean;
  };
  checklist: ChecklistItem[];
  done_count: number;
}

function readState(settings: Record<string, unknown>): OnboardingState | null {
  const raw = settings.onboarding as Partial<OnboardingState> | undefined;
  if (!raw || typeof raw !== "object" || !ONBOARDING_STEPS.includes(raw.step as OnboardingStep)) return null;
  return {
    step: raw.step as OnboardingStep,
    started_at: typeof raw.started_at === "string" ? raw.started_at : "",
    completed_at: typeof raw.completed_at === "string" ? raw.completed_at : null,
    checklist_dismissed_at: typeof raw.checklist_dismissed_at === "string" ? raw.checklist_dismissed_at : null,
    free_plan_chosen_at: typeof raw.free_plan_chosen_at === "string" ? raw.free_plan_chosen_at : null,
  };
}

const isCategory = (v: unknown): v is BusinessCategory => typeof v === "string" && (BUSINESS_CATEGORIES as readonly string[]).includes(v);

export class OnboardingService {
  /** The progress record a new self-registered workspace starts with. */
  public static initialState(now: string = new Date().toISOString()): OnboardingState {
    return { step: "welcome", started_at: now, completed_at: null, checklist_dismissed_at: null, free_plan_chosen_at: null };
  }

  /** Progress, answers so far and the launch checklist. Read-only. */
  public static async getStatus(context: RequestContext): Promise<OnboardingStatus> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_READ);
    const tenantId = context.tenant.id;
    const tenant = TenantService.getTenantById(tenantId);
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const state = readState(settings);
    const deliveryFeesSet =
      typeof settings.delivery_charge_inside_dhaka === "number" && typeof settings.delivery_charge_outside_dhaka === "number";
    const category = isCategory(settings.business_category) ? settings.business_category : null;

    const payments = db.getTenantPaymentSettings(tenantId);
    const manual = (payments?.manual ?? {}) as Record<string, unknown>;
    const hasWallet = ["bkash_number", "nagad_number", "rocket_number"].some((k) => typeof manual[k] === "string" && (manual[k] as string).length > 0);
    const hasGateway = Object.values(payments?.gateways ?? {}).some((g) => Boolean(g && (g as { enabled?: boolean }).enabled));
    const [productCount, orderCount] = await Promise.all([productRepository.countByTenant(tenantId), orderRepository.countByTenant(tenantId)]);
    const channelCount = db.getConnectedChannels(tenantId).filter((c) => c.status === "ACTIVE").length;

    const checklist: ChecklistItem[] = [
      { id: "shop", label: "Shop name and category", hint: "Who you are and what you sell", done: Boolean(tenant.name?.trim()) && category !== null, href: "/onboarding" },
      { id: "delivery", label: "Delivery charges", hint: "Inside and outside Dhaka", done: deliveryFeesSet, href: "/settings" },
      { id: "payments", label: "A way to get paid", hint: "bKash, Nagad or Rocket number, or a payment gateway", done: hasWallet || hasGateway, href: "/payments" },
      { id: "product", label: "Your first product", hint: "Your assistant can only sell what's in your catalog", done: productCount > 0, href: "/products" },
      { id: "channel", label: "Connect a sales channel", hint: "Facebook Page, Instagram or WhatsApp", done: channelCount > 0, href: "/connector" },
      { id: "plan", label: "Choose a plan or start your trial", hint: "Free, a paid plan or a free trial", done: Boolean(db.findSubscriptionByTenantId(tenantId) || state?.free_plan_chosen_at), href: "/settings/billing" },
      { id: "first_order", label: "Get your first order", hint: "Ticks itself when a customer orders", done: orderCount > 0, href: "/orders" },
    ];
    const doneCount = checklist.filter((item) => item.done).length;

    return {
      state,
      needs_onboarding: Boolean(state && !state.completed_at),
      show_checklist: Boolean(state && state.completed_at && !state.checklist_dismissed_at && doneCount < checklist.length),
      profile: {
        shop_name: tenant.name,
        language: tenant.language ?? "bn",
        business_category: category,
        delivery_fees: PricingService.getDeliveryFees(tenantId),
        delivery_fees_set: deliveryFeesSet,
      },
      checklist,
      done_count: doneCount,
    };
  }

  /** Saves answers and progress (settings.update). Only the fields given change. */
  public static async update(context: RequestContext, input: OnboardingUpdate): Promise<OnboardingStatus> {
    RbacService.assertCan(context, PERMISSIONS.SETTINGS_UPDATE);
    const tenantId = context.tenant.id;
    const tenant = TenantService.getTenantById(tenantId);
    const now = new Date().toISOString();
    const feesBefore = PricingService.getDeliveryFees(tenantId);
    const current = readState((tenant.settings ?? {}) as Record<string, unknown>);
    // Only self-registered shops have onboarding; older workspaces change these things in Settings
    if (!current) throw new AppError("ONBOARDING_NOT_AVAILABLE", "This workspace doesn't use shop setup. Change these in Settings.", 409);
    const next: OnboardingState = {
      ...current,
      ...(input.step ? { step: input.step } : {}),
      ...(input.complete ? { completed_at: current.completed_at ?? now } : {}),
      ...(input.dismiss_checklist ? { checklist_dismissed_at: now } : {}),
      ...(input.choose_free_plan ? { free_plan_chosen_at: current.free_plan_chosen_at ?? now } : {}),
    };

    const settings: Record<string, unknown> = { onboarding: next };
    if (input.business_category) settings.business_category = input.business_category;
    if (input.delivery_charge_inside_dhaka !== undefined) settings.delivery_charge_inside_dhaka = input.delivery_charge_inside_dhaka;
    if (input.delivery_charge_outside_dhaka !== undefined) settings.delivery_charge_outside_dhaka = input.delivery_charge_outside_dhaka;

    TenantService.updateTenantSettings(tenantId, {
      ...(input.shop_name ? { name: input.shop_name } : {}),
      ...(input.language ? { language: input.language } : {}),
      settings,
    });

    AuditService.log({
      tenantId,
      actorUserId: context.user.id,
      action: "ONBOARDING_UPDATED",
      resourceType: "tenant",
      resourceId: tenantId,
      metadata: {
        changes: input,
        before: {
          shop_name: tenant.name,
          language: tenant.language ?? null,
          business_category: (tenant.settings as Record<string, unknown> | undefined)?.business_category ?? null,
          delivery_fees: feesBefore,
        },
        step: next.step,
        completed: Boolean(next.completed_at),
      },
    });

    return OnboardingService.getStatus(context);
  }
}
