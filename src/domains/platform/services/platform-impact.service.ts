/**
 * Read-only impact preview for privileged actions (super-admin console plan §5.4 step 1): real counts of what an
 * action would touch, computed now. When something can't be counted from platform data, the line says so
 * (value: null) instead of guessing.
 */
import { db } from "@/infrastructure/db";
import { PlatformContext } from "@/lib/context";
import { AppError, NotFoundError } from "@/lib/errors";
import { PlatformAuthorizationService } from "./platform-authorization.service";

export interface ImpactLine {
  label: string;
  value: number | null;
  note?: string;
}

export interface ImpactPreview {
  action: string;
  target: string;
  summary: string;
  lines: ImpactLine[];
  computed_at: string;
}

const OPEN_CONVERSATION = new Set(["OPEN", "PENDING", "WAITING_CUSTOMER", "WAITING_AGENT", "ASSIGNED", "ESCALATED"]);

function tenantLines(tenantId: string): ImpactLine[] {
  const members = db.findMembershipsByTenantId(tenantId).filter((m) => m.status !== "SUSPENDED").length;
  const automations = (db.data.automations || []).filter((a) => a.tenant_id === tenantId && a.status === "ACTIVE").length;
  const channels = db.getConnectedChannels(tenantId).filter((c) => c.status === "ACTIVE").length;
  const conversations = (db.data.conversations || []).filter((c) => c.tenant_id === tenantId && OPEN_CONVERSATION.has(c.status)).length;
  const sub = db.findSubscriptionByTenantId(tenantId);
  return [
    { label: "Staff who lose write access", value: members },
    { label: "Active automations that stop", value: automations },
    { label: "Connected channels that stop sending", value: channels },
    { label: "Open customer conversations", value: conversations },
    { label: "Subscription", value: null, note: sub ? `${sub.plan_id} · ${sub.status.toLowerCase()} (billing is not changed)` : "No subscription" },
  ];
}

export class PlatformImpactService {
  public static preview(context: PlatformContext, action: string, scope: string | null, target: string | null): ImpactPreview {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    const computed_at = new Date().toISOString();

    if (action === "tenant.suspend" || action === "tenant.archive" || action === "tenant.purge" || (action.startsWith("kill_switch.") && scope === "TENANT")) {
      if (!target) throw new AppError("TARGET_REQUIRED", "Name the tenant.", 400);
      const tenant = db.findTenantById(target);
      if (!tenant) throw new NotFoundError("Tenant not found.");
      const summary =
        action === "tenant.purge"
          ? `${tenant.name} is archived now; its data is kept for 14 days. Nothing is deleted by this action.`
          : action === "tenant.archive"
            ? `${tenant.name} is archived: staff can no longer sign in to it. Data is kept.`
            : `Every change in ${tenant.name} is refused (503) while reads keep working.`;
      return { action, target: tenant.name, summary, lines: tenantLines(tenant.id), computed_at };
    }

    if (action.startsWith("kill_switch.") && scope === "GLOBAL") {
      const live = db.getTenants().filter((t) => t.status === "ACTIVE" || t.status === "TRIAL");
      const automations = (db.data.automations || []).filter((a) => a.status === "ACTIVE").length;
      const conversations = (db.data.conversations || []).filter((c) => OPEN_CONVERSATION.has(c.status)).length;
      return {
        action,
        target: "Every workspace",
        summary: "Every non-GET request on the platform is refused (503); reads keep working.",
        lines: [
          { label: "Active or trial workspaces affected", value: live.length },
          { label: "Active automations that stop", value: automations },
          { label: "Open customer conversations", value: conversations },
        ],
        computed_at,
      };
    }

    if (action.startsWith("kill_switch.") && scope === "CHANNEL") {
      if (!target) throw new AppError("TARGET_REQUIRED", "Name the channel id or channel type.", 400);
      const channels = (db.data.connected_channels || []).filter((c) => c.id === target || c.type === target);
      return {
        action,
        target,
        summary: `Outbound messages, campaigns and AI replies on ${target} are refused.`,
        lines: [
          { label: "Matching connected channels", value: channels.length },
          { label: "Workspaces using them", value: new Set(channels.map((c) => c.tenant_id)).size },
        ],
        computed_at,
      };
    }

    if (action.startsWith("kill_switch.") && scope === "WORKFLOW") {
      if (!target) throw new AppError("TARGET_REQUIRED", "Name the workflow.", 400);
      const automations = (db.data.automations || []).filter((a) => a.workflow_id === target);
      return {
        action,
        target,
        summary: `Runs of workflow ${target} are halted.`,
        lines: [
          { label: "Automations bound to it", value: automations.length },
          { label: "Workspaces using it", value: new Set(automations.map((a) => a.tenant_id)).size },
        ],
        computed_at,
      };
    }

    if (action.startsWith("kill_switch.") && scope === "PROVIDER") {
      if (!target) throw new AppError("TARGET_REQUIRED", "Name the provider.", 400);
      return {
        action,
        target,
        summary: `Calls to ${target} (AI models, couriers, payment rails) are refused.`,
        lines: [{ label: "Calls that would be refused", value: null, note: "Not countable ahead of time: depends on live traffic." }],
        computed_at,
      };
    }

    throw new AppError("NO_IMPACT_PREVIEW", `No impact preview for "${action}"${scope ? ` (${scope})` : ""}.`, 400);
  }
}
