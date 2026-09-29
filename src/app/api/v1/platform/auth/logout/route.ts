import { apiSuccess } from "@/lib/api-response";
import { PLATFORM_AUTH_COOKIE_NAME } from "@/lib/security";
import { withStore } from "@/lib/store-unit";

async function handlePOST() {
  const response = apiSuccess({ message: "Successfully logged out of platform session." });
  response.cookies.delete(PLATFORM_AUTH_COOKIE_NAME);
  return response;
}

export const POST = withStore("POST", handlePOST);
