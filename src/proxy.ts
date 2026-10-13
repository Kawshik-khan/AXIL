import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The front door. A visitor who opens the site (`/`) without a workspace session sees the public landing page
 * (`/welcome`); someone who is signed in still gets the dashboard at `/`.
 *
 * This only looks at whether a session cookie is present, and it is not a security control: it never reads or
 * trusts the cookie's value. An expired or forged cookie still reaches the dashboard, whose layout checks the real
 * session and sends the person to /login, and every API route authenticates for itself. The landing page is static
 * and public, so showing it to the wrong person reveals nothing.
 *
 * The names match AUTH_COOKIE_NAME (src/lib/security.ts) and IMPERSONATION_COOKIE_NAME (src/lib/impersonation.ts).
 * They are repeated here because a proxy should not import shared modules; tests/landing-routing-tests.ts fails if
 * they drift. Proxy runs on every matched request, so it matches `/` only.
 */
export const WORKSPACE_SESSION_COOKIES = ["commerceos_session", "commerceos_impersonation"] as const;

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== "/") return NextResponse.next();

  // Opt-in local browsing without a token (see AGENTS.md): keep opening the dashboard.
  if (process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "1") return NextResponse.next();

  if (WORKSPACE_SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();

  return NextResponse.rewrite(new URL("/welcome", request.url));
}

export const config = {
  matcher: "/",
};
