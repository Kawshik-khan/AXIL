import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

export class SocialAnalyticsService {
  public static async getMetrics(context: RequestContext) {
    RbacService.assertCan(context, PERMISSIONS.SOCIAL_ANALYTICS_READ);
    return db.getSocialDashboardMetrics(context.tenant.id);
  }
}
