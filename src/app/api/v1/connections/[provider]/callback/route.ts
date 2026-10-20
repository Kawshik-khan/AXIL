import { handleConnectionCallback } from "@/domains/connectors/auth/callback-handler";
import { withStore } from "@/lib/store-unit";

/** The provider's redirect after sign-in; see handleConnectionCallback (GET, writes nothing to the store). */
async function handleGET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handleConnectionCallback(request, provider);
}

export const GET = withStore("GET", handleGET);
