import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

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
