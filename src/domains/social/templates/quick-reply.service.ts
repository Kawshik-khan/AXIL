import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import { QuickReply, QuickReplyCategory, BusinessHours, DaySchedule } from "@/types/social";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError } from "@/lib/errors";

export class QuickReplyService {
  public static async listQuickReplies(
    context: RequestContext,
    category?: QuickReplyCategory
  ): Promise<QuickReply[]> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_READ);
    return db.getQuickReplies(context.tenant.id, category);
  }

  public static async createQuickReply(
    context: RequestContext,
    payload: {
      title: string;
      content: string;
      category: QuickReplyCategory;
      shortcut?: string;
    }
  ): Promise<QuickReply> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_MANAGE);

    if (!payload.title || !payload.content) {
      throw new BadRequestError("Title and content are required for quick replies.");
    }

    const reply: QuickReply = {
      id: `qr_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      title: payload.title,
      content: payload.content,
      category: payload.category || "General",
      active: true,
      shortcut: payload.shortcut,
      created_at: new Date().toISOString(),
    };

    return db.createQuickReply(reply);
  }

  public static async deleteQuickReply(
    context: RequestContext,
    id: string
  ): Promise<{ success: boolean }> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_TEMPLATE_MANAGE);
    const deleted = db.deleteQuickReply(context.tenant.id, id);
    return { success: deleted };
  }

  public static async getBusinessHours(context: RequestContext): Promise<BusinessHours> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_READ);
    let hours = db.getBusinessHours(context.tenant.id);
    if (!hours) {
      const defaultSchedule: DaySchedule[] = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ].map((day) => ({
        day: day as any,
        is_open: day !== "Friday", // Bangladesh weekend default
        open_time: "09:00",
        close_time: "21:00",
      }));

      hours = {
        id: `bh_${context.tenant.id}`,
        tenant_id: context.tenant.id,
        timezone: "Asia/Dhaka",
        schedule: defaultSchedule,
        auto_reply_enabled: true,
        offline_message: "ধন্যবাদ! আমরা বর্তমানে অফলাইনে আছি। কর্মদিবসে সকাল ৯টা থেকে রাত ৯টার মধ্যে আমরা আপনার মেসেজের উত্তর দিব।",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Default returned, not stored: reads never write (FX-21). updateBusinessHours stores it.
    }
    return hours;
  }

  public static async updateBusinessHours(
    context: RequestContext,
    payload: Partial<BusinessHours>
  ): Promise<BusinessHours> {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const current = await this.getBusinessHours(context);
    const updated: BusinessHours = {
      ...current,
      ...payload,
      updated_at: new Date().toISOString(),
    };
    return db.setBusinessHours(updated);
  }

  public static isWithinBusinessHours(hours: BusinessHours, date = new Date()): boolean {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDay = days[date.getDay()];
    const dayConfig = hours.schedule.find((s) => s.day === currentDay);
    if (!dayConfig || !dayConfig.is_open) return false;

    const currentHour = date.getHours().toString().padStart(2, "0");
    const currentMin = date.getMinutes().toString().padStart(2, "0");
    const currentTime = `${currentHour}:${currentMin}`;

    return currentTime >= dayConfig.open_time && currentTime <= dayConfig.close_time;
  }
}
