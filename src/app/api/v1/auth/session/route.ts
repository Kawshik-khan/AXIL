import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";
import { WorkspaceAccessService } from "@/domains/billing/workspace-access.service";

export const dynamic = "force-dynamic";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const platformMembership = db.findPlatformMembershipByUserId(context.user.id);

    const res = apiSuccess({
      user: context.user,
      tenant: context.tenant,
      role: context.role,
      permissions: context.permissions,
      isPlatformUser: !!(platformMembership && platformMembership.is_active),
      platformRole: platformMembership?.is_active ? platformMembership.role : undefined,
      impersonation: context.impersonation ?? null,
      // Where the workspace stands with setup and payment (computed, read-only); a support session is never held back
      access: context.impersonation ? null : WorkspaceAccessService.resolve(context.tenant.id),
    });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (err) {
    const errRes = apiError(err);
    errRes.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return errRes;
  }
}

export const GET = withStore("GET", handleGET);
