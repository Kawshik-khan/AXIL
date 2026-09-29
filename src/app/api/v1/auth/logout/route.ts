import { apiSuccess } from "@/lib/api-response";
import { AUTH_COOKIE_NAME, PLATFORM_AUTH_COOKIE_NAME } from "@/lib/security";
import { withStore } from "@/lib/store-unit";

const expired = { value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 0 };

/** Signs out of this browser: clears the workspace and platform session cookies (FX-15). */
async function handlePOST() {
  const response = apiSuccess({ message: "Successfully logged out." });
  response.cookies.set({ name: AUTH_COOKIE_NAME, ...expired });
  response.cookies.set({ name: PLATFORM_AUTH_COOKIE_NAME, ...expired });
  return response;
}

export const POST = withStore("POST", handlePOST);
