import { apiSuccess, apiError } from "@/lib/api-response";
import { NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";
import { verifyDeletionCode } from "@/domains/connectors/connection-lifecycle";

/** Status of a Meta data deletion request (public; the signed code is the only input; reads nothing, writes nothing). */
async function handleGET(_request: Request, { params }: { params: Promise<{ provider: string; code: string }> }) {
  try {
    const { provider, code } = await params;
    // Next has already decoded the path segment
    const verified = provider === "meta" ? verifyDeletionCode(process.env.META_APP_SECRET ?? "", code) : null;
    if (!verified) throw new NotFoundError("Deletion request");
    return apiSuccess({
      status: verified.status,
      requested_at: verified.completedAt,
      message:
        verified.status === "COMPLETED"
          ? "CommerceOS deleted the connections made with this Facebook login: their access token, granted permissions, the Pages and ad accounts reached through them, and the channels those Pages served. Audit records of the connection remain, as the law on business records requires."
          : "CommerceOS deleted the connections it could match to this Facebook login. Some older connections couldn't be checked with Facebook yet; they are matched and deleted when Facebook answers.",
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
