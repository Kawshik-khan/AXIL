import { NextResponse } from "next/server";
import { db } from "@/infrastructure/db";
import { QuickReplyService } from "@/domains/social/templates/quick-reply.service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantSlug = searchParams.get("tenant") || "dhaka-d2c-apparel";

    // Find tenant by slug
    const tenant = (db as any).data.tenants.find((t: any) => t.slug === tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant workspace not found" }, { status: 404 });
    }

    const channel = db.getConnectedChannels(tenant.id).find((c) => c.type === "WEBSITE_CHAT" && c.status === "ACTIVE");
    const businessHours = db.getBusinessHours(tenant.id);
    const isOnline = businessHours ? QuickReplyService.isWithinBusinessHours(businessHours) : true;

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
      },
      widget: {
        enabled: !!channel,
        title: channel?.name || `${tenant.name} Support`,
        welcomeMessage: channel?.configuration.welcome_message || "স্বাগতম! আমরা কীভাবে আপনাকে সাহায্য করতে পারি?",
        offlineMessage: businessHours?.offline_message || "আমরা বর্তমানে অফলাইনে আছি। অনুগ্রহ করে আপনার বার্তাটি রেখে যান।",
        primaryColor: channel?.configuration.widget_color || "#C7F900",
        position: channel?.configuration.widget_position || "bottom-right",
        isOnline,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load widget configuration" }, { status: 500 });
  }
}
