/**
 * Maintenance windows and announcements (super-admin console plan §J, SA-8). Windows are informational: a banner in
 * the console and in merchant workspaces; nothing is blocked by them (the record's read_only_mode is not enforced,
 * so it is never set). Announcements reach the merchant dashboard through GET /api/v1/announcements.
 * Status is derived from the clock on read; nothing is rewritten when time passes.
 */
import { db } from "@/infrastructure/db";
import type { PlatformAnnouncementRecord, PlatformMaintenanceWindowRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { AppError, NotFoundError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PrivilegedActionGate } from "./privileged-action-gate";

export type MaintenanceStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface MaintenanceView extends PlatformMaintenanceWindowRecord {
  effective_status: MaintenanceStatus;
  is_active: boolean;
}

export type AnnouncementStatus = "DRAFT" | "PUBLISHED" | "EXPIRED";

export interface AnnouncementView extends PlatformAnnouncementRecord {
  effective_status: AnnouncementStatus;
}

/** What a merchant sees: no targeting internals. */
export interface TenantNotice {
  id: string;
  kind: "ANNOUNCEMENT" | "MAINTENANCE";
  type: string;
  title: string;
  message: string;
  starts_at: string | null;
  ends_at: string | null;
}

function maintenanceStatus(w: PlatformMaintenanceWindowRecord, now: number): MaintenanceStatus {
  if (w.status === "CANCELLED") return "CANCELLED";
  if (now < Date.parse(w.scheduled_start)) return "SCHEDULED";
  if (now < Date.parse(w.scheduled_end)) return "IN_PROGRESS";
  return "COMPLETED";
}

function announcementStatus(a: PlatformAnnouncementRecord, now: number): AnnouncementStatus {
  if (!a.is_published) return "DRAFT";
  if (a.expires_at && Date.parse(a.expires_at) <= now) return "EXPIRED";
  return "PUBLISHED";
}

function targetsTenant(a: PlatformAnnouncementRecord, tenantId: string, planId: string | undefined): boolean {
  switch (a.target_scope) {
    case "ALL_TENANTS":
      return true;
    case "PLAN": {
      const plans = (a.target_filter?.plan_ids as unknown[] | undefined) ?? [];
      return Boolean(planId) && plans.includes(planId);
    }
    case "TENANT_LIST": {
      const tenants = (a.target_filter?.tenant_ids as unknown[] | undefined) ?? [];
      return tenants.includes(tenantId);
    }
    default:
      return false;
  }
}

export class PlatformCommunicationsService {
  // ---------- Maintenance ----------
  public static listMaintenance(context: PlatformContext, now: number = Date.now()): MaintenanceView[] {
    PlatformAuthorizationService.assertCan(context, "maintenance.read");
    return db
      .getPlatformMaintenanceWindows()
      .map((w) => {
        const effective = maintenanceStatus(w, now);
        return { ...w, effective_status: effective, is_active: effective === "IN_PROGRESS" };
      })
      .sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start));
  }

  public static scheduleMaintenance(
    context: PlatformContext,
    input: { title: string; description: string; scheduled_start: string; scheduled_end: string; reason: string }
  ): PlatformMaintenanceWindowRecord {
    PrivilegedActionGate.assert(context, "maintenance.schedule", { reason: input.reason, payload: { title: input.title } });
    const start = Date.parse(input.scheduled_start);
    const end = Date.parse(input.scheduled_end);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      throw new AppError("INVALID_WINDOW", "The window must end after it starts.", 400);
    }
    if (end <= Date.now()) throw new AppError("INVALID_WINDOW", "The window must end in the future.", 400);

    const record: PlatformMaintenanceWindowRecord = {
      id: `mw_${randomSuffix()}`,
      title: input.title.trim(),
      description: input.description.trim(),
      scheduled_start: new Date(start).toISOString(),
      scheduled_end: new Date(end).toISOString(),
      status: "SCHEDULED",
      allowed_roles: [],
      read_only_mode: false,
      created_at: new Date().toISOString(),
    };
    db.savePlatformMaintenanceWindow(record);
    PlatformAuditService.record(
      { action: "maintenance.schedule", resource_type: "maintenance_window", resource_id: record.id, reason: input.reason.trim(), after_state: { ...record }, result: "SUCCESS" },
      context
    );
    return record;
  }

  public static cancelMaintenance(context: PlatformContext, id: string, reason: string): PlatformMaintenanceWindowRecord {
    PrivilegedActionGate.assert(context, "maintenance.cancel", { reason, payload: { id } });
    const existing = db.getPlatformMaintenanceWindows().find((w) => w.id === id);
    if (!existing) throw new NotFoundError("Maintenance window not found.");
    if (maintenanceStatus(existing, Date.now()) === "COMPLETED" || existing.status === "CANCELLED") {
      throw new AppError("WINDOW_CLOSED", "This window is already over or cancelled.", 409);
    }
    const updated: PlatformMaintenanceWindowRecord = { ...existing, status: "CANCELLED" };
    db.savePlatformMaintenanceWindow(updated);
    PlatformAuditService.record(
      { action: "maintenance.cancel", resource_type: "maintenance_window", resource_id: id, reason: reason.trim(), before_state: { status: existing.status }, after_state: { status: "CANCELLED" }, result: "SUCCESS" },
      context
    );
    return updated;
  }

  // ---------- Announcements ----------
  public static listAnnouncements(context: PlatformContext, now: number = Date.now()): AnnouncementView[] {
    PlatformAuthorizationService.assertCan(context, "platform.read");
    return db.getPlatformAnnouncements().map((a) => ({ ...a, effective_status: announcementStatus(a, now) }));
  }

  public static saveAnnouncement(
    context: PlatformContext,
    input: {
      id?: string;
      title: string;
      message: string;
      announcement_type: PlatformAnnouncementRecord["announcement_type"];
      target_scope: "ALL_TENANTS" | "PLAN" | "TENANT_LIST";
      plan_ids?: string[];
      target_tenant_ids?: string[];
      expires_at?: string;
    }
  ): PlatformAnnouncementRecord {
    PlatformAuthorizationService.assertCan(context, input.id ? "announcement.update" : "announcement.create");
    const existing = input.id ? db.getPlatformAnnouncements().find((a) => a.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundError("Announcement not found.");
    if (existing?.is_published) throw new AppError("ANNOUNCEMENT_PUBLISHED", "Unpublish the announcement before editing it.", 409);

    const planIds = input.plan_ids ?? [];
    const tenantIds = input.target_tenant_ids ?? [];
    if (input.target_scope === "PLAN" && planIds.length === 0) throw new AppError("TARGET_REQUIRED", "Choose at least one plan.", 400);
    if (input.target_scope === "TENANT_LIST" && tenantIds.length === 0) throw new AppError("TARGET_REQUIRED", "Choose at least one tenant.", 400);
    const unknownPlans = planIds.filter((p) => !db.findPlanById(p));
    const unknownTenants = tenantIds.filter((t) => !db.findTenantById(t));
    if (unknownPlans.length || unknownTenants.length) {
      throw new AppError("UNKNOWN_TARGETS", `Unknown targets: ${[...unknownPlans, ...unknownTenants].join(", ")}`, 400);
    }
    if (input.expires_at && Date.parse(input.expires_at) <= Date.now()) {
      throw new AppError("INVALID_EXPIRY", "The expiry must be in the future.", 400);
    }

    const now = new Date().toISOString();
    const record: PlatformAnnouncementRecord = {
      id: existing?.id ?? `ann_${randomSuffix()}`,
      title: input.title.trim(),
      message: input.message.trim(),
      announcement_type: input.announcement_type,
      target_scope: input.target_scope,
      target_filter: input.target_scope === "PLAN" ? { plan_ids: planIds } : input.target_scope === "TENANT_LIST" ? { tenant_ids: tenantIds } : {},
      is_published: false,
      ...(input.expires_at ? { expires_at: new Date(input.expires_at).toISOString() } : {}),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    db.savePlatformAnnouncement(record);
    PlatformAuditService.record(
      {
        action: existing ? "announcement.update" : "announcement.create",
        resource_type: "announcement",
        resource_id: record.id,
        reason: `Announcement draft: ${record.title}`,
        after_state: { title: record.title, target_scope: record.target_scope },
        result: "SUCCESS",
      },
      context
    );
    return record;
  }

  public static setPublished(context: PlatformContext, id: string, publish: boolean): PlatformAnnouncementRecord {
    PrivilegedActionGate.assert(context, "announcement.publish", { payload: { id, publish } });
    const existing = db.getPlatformAnnouncements().find((a) => a.id === id);
    if (!existing) throw new NotFoundError("Announcement not found.");
    if (existing.is_published === publish) {
      throw new AppError("NO_CHANGE", publish ? "Already published." : "Already unpublished.", 409);
    }
    const now = new Date().toISOString();
    const updated: PlatformAnnouncementRecord = {
      ...existing,
      is_published: publish,
      ...(publish ? { published_at: now } : {}),
      updated_at: now,
    };
    db.savePlatformAnnouncement(updated);
    PlatformAuditService.record(
      {
        action: publish ? "announcement.publish" : "announcement.unpublish",
        resource_type: "announcement",
        resource_id: id,
        reason: `${publish ? "Published" : "Unpublished"}: ${existing.title}`,
        before_state: { is_published: existing.is_published },
        after_state: { is_published: publish },
        result: "SUCCESS",
      },
      context
    );
    return updated;
  }

  /** Published, unexpired announcements targeted at this tenant, plus maintenance in progress or within 72 h. */
  public static noticesForTenant(tenantId: string, now: number = Date.now()): TenantNotice[] {
    const planId = db.findSubscriptionByTenantId(tenantId)?.plan_id ?? db.findTenantById(tenantId)?.plan_id;
    const announcements: TenantNotice[] = db
      .getPlatformAnnouncements()
      .filter((a) => announcementStatus(a, now) === "PUBLISHED" && targetsTenant(a, tenantId, planId))
      .map((a) => ({
        id: a.id,
        kind: "ANNOUNCEMENT",
        type: a.announcement_type,
        title: a.title,
        message: a.message,
        starts_at: a.published_at ?? null,
        ends_at: a.expires_at ?? null,
      }));
    const horizon = now + 72 * 60 * 60 * 1000;
    const maintenance: TenantNotice[] = db
      .getPlatformMaintenanceWindows()
      .filter((w) => {
        const status = maintenanceStatus(w, now);
        return status === "IN_PROGRESS" || (status === "SCHEDULED" && Date.parse(w.scheduled_start) <= horizon);
      })
      .map((w) => ({
        id: w.id,
        kind: "MAINTENANCE",
        type: maintenanceStatus(w, now),
        title: w.title,
        message: w.description,
        starts_at: w.scheduled_start,
        ends_at: w.scheduled_end,
      }));
    return [...maintenance, ...announcements];
  }
}
