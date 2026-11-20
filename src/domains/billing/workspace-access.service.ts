/**
 * Workspace access (ADR-125): whether a workspace may use CommerceOS right now, given its setup and its subscription.
 *
 * A workspace that signed up through the public sign-up page is "paywalled": it must finish shop setup and then have a
 * subscription that is paid (or an operator-granted trial) before anything outside setup and billing works. The state
 * is computed from real records on every call and never stored, so a GET can ask for it (non-negotiable 9), and it
 * changes the moment BillingService.settle marks an invoice PAID — there is no second writer.
 *
 * Workspaces created any other way (seeded, operator-created, invited) are not paywalled; their plan limits keep
 * working through PlatformEntitlementService as before. Operators can switch the paywall off platform-wide with the
 * `billing.require_paid_subscription` setting.
 */
import { db } from "@/infrastructure/db";
import { PlatformEntitlementService } from "@/domains/platform/services/platform-entitlement.service";
import { PlatformSettingsService } from "@/domains/platform/services/platform-settings.service";
import { AppError } from "@/lib/errors";

export type WorkspaceAccessState = "ACTIVE" | "GRACE" | "SETUP_REQUIRED" | "PAYMENT_REQUIRED" | "PAYMENT_PENDING" | "LOCKED";

export interface WorkspaceAccess {
  state: WorkspaceAccessState;
  /** Whether this workspace is subject to the paywall at all. */
  paywalled: boolean;
  /** Where the owner should go to get access; null when they already have it. */
  next_path: string | null;
  reason: string;
  /** In GRACE: when access stops unless the open invoice is paid. */
  grace_ends_at: string | null;
}

/** The platform setting that turns the paywall on (default on). Declared in settings-registry.ts. */
export const REQUIRE_PAID_SUBSCRIPTION_SETTING = "billing.require_paid_subscription";

/** The page a paywalled owner pays on (outside the dashboard shell). */
export const ACTIVATION_PATH = "/activate";
export const ONBOARDING_PATH = "/onboarding";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What tenant.settings.access_gate holds: set once, by the public sign-up route only. */
export interface AccessGateMarker {
  paid_required_since: string;
}

export function accessGateMarker(now: string = new Date().toISOString()): AccessGateMarker {
  return { paid_required_since: now };
}

function hasMarker(settings: Record<string, unknown> | undefined): boolean {
  const gate = settings?.access_gate as Partial<AccessGateMarker> | undefined;
  return Boolean(gate && typeof gate === "object" && typeof gate.paid_required_since === "string");
}

/**
 * API path prefixes a workspace without access can still call, by state. Everything a workspace needs to finish setup,
 * see its plan and pay; nothing that reads or changes shop data.
 */
const ALWAYS_ALLOWED = ["/api/v1/auth", "/api/v1/billing", "/api/v1/onboarding"];
const SETUP_ALLOWED = [
  // The setup flow's "try your assistant" step: simulate mode, nothing is sent or saved
  "/api/v1/ai/simulate",
];

function allowed(state: WorkspaceAccessState, path: string): boolean {
  if (state === "ACTIVE" || state === "GRACE") return true;
  const match = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (ALWAYS_ALLOWED.some(match)) return true;
  return state === "SETUP_REQUIRED" && SETUP_ALLOWED.some(match);
}

const MESSAGES: Record<Exclude<WorkspaceAccessState, "ACTIVE" | "GRACE">, string> = {
  SETUP_REQUIRED: "Finish setting up your shop first.",
  PAYMENT_REQUIRED: "Choose a plan and pay for it to start using CommerceOS.",
  PAYMENT_PENDING: "We're checking your payment. Your workspace opens as soon as it's confirmed.",
  LOCKED: "Your subscription has ended. Pay to keep using CommerceOS; your data is safe.",
};

/** Raised for an API call the workspace can't make until it has access (HTTP 402). */
export class WorkspaceAccessRequiredError extends AppError {
  constructor(access: WorkspaceAccess) {
    const state = access.state as keyof typeof MESSAGES;
    super(`WORKSPACE_${state}`, MESSAGES[state], 402, { state: access.state, next_path: access.next_path });
  }
}

export class WorkspaceAccessService {
  /** Whether the paywall applies to this workspace (it signed up publicly and the platform setting is on). */
  public static isPaywalled(tenantId: string): boolean {
    const tenant = db.findTenantById(tenantId);
    if (!tenant || !hasMarker(tenant.settings as Record<string, unknown> | undefined)) return false;
    return PlatformSettingsService.getEffectiveSetting<boolean>(REQUIRE_PAID_SUBSCRIPTION_SETTING) !== false;
  }

  /** The workspace's access right now. Read-only. */
  public static resolve(tenantId: string, now: number = Date.now()): WorkspaceAccess {
    const open = (reason: string): WorkspaceAccess => ({ state: "ACTIVE", paywalled: false, next_path: null, reason, grace_ends_at: null });
    if (!WorkspaceAccessService.isPaywalled(tenantId)) return open("Not paywalled");

    const tenant = db.findTenantById(tenantId)!;
    const onboarding = (tenant.settings as Record<string, unknown> | undefined)?.onboarding as { completed_at?: unknown } | undefined;
    if (onboarding && typeof onboarding === "object" && typeof onboarding.completed_at !== "string") {
      return { state: "SETUP_REQUIRED", paywalled: true, next_path: ONBOARDING_PATH, reason: "Shop setup not finished", grace_ends_at: null };
    }

    const plan = PlatformEntitlementService.planApplicability(tenantId, now);
    const subscription = plan.subscription;
    if (plan.applies && subscription) {
      const graceDays = PlatformSettingsService.getEffectiveSetting<number>("billing.past_due_grace_days");
      const endOf = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);
      const end =
        subscription.status === "PAST_DUE"
          ? endOf(subscription.current_period_end)
          : subscription.status === "TRIAL"
            ? endOf(subscription.trial_ends_at)
            : NaN;
      if (!Number.isNaN(end) && now > end) {
        return {
          state: "GRACE",
          paywalled: true,
          next_path: ACTIVATION_PATH,
          reason: plan.reason,
          grace_ends_at: new Date(end + graceDays * DAY_MS).toISOString(),
        };
      }
      return { state: "ACTIVE", paywalled: true, next_path: null, reason: plan.reason, grace_ends_at: null };
    }

    if (db.getBillingInvoices(tenantId).some((invoice) => invoice.status === "PENDING_VERIFICATION")) {
      return { state: "PAYMENT_PENDING", paywalled: true, next_path: ACTIVATION_PATH, reason: "A manual payment is being checked", grace_ends_at: null };
    }
    if (subscription) {
      return { state: "LOCKED", paywalled: true, next_path: ACTIVATION_PATH, reason: plan.reason, grace_ends_at: null };
    }
    return { state: "PAYMENT_REQUIRED", paywalled: true, next_path: ACTIVATION_PATH, reason: "No paid subscription", grace_ends_at: null };
  }

  /**
   * Refuses (402) an API call the workspace can't make without access. Called from extractRequestContext for every
   * workspace request, so no route can forget it. `bypass`: a platform operator's support session.
   */
  public static assertAllowed(tenantId: string, path: string, options: { bypass?: boolean } = {}): void {
    if (options.bypass) return;
    const access = WorkspaceAccessService.resolve(tenantId);
    if (!allowed(access.state, path)) throw new WorkspaceAccessRequiredError(access);
  }
}
