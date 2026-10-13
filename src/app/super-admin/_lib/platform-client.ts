/**
 * Client-side fetch helper for the platform control plane.
 *
 * Identity comes only from the httpOnly platform session cookie set by POST /api/v1/platform/auth/login
 * (same-origin requests send it automatically). A 401 means there is no valid platform session, so the
 * operator is sent to the sign-in page. Step-up tokens, when present, travel in `x-step-up-token`.
 */
export const PLATFORM_LOGIN_PATH = "/super-admin/login";

export class PlatformSessionExpiredError extends Error {
  constructor() {
    super("Your platform session has expired. Please sign in again.");
    this.name = "PlatformSessionExpiredError";
  }
}

export async function platformFetch(
  url: string,
  init: RequestInit = {},
  stepUpToken?: string | null
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (stepUpToken) {
    headers.set("x-step-up-token", stepUpToken);
  }

  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401) {
    window.location.assign(PLATFORM_LOGIN_PATH);
    throw new PlatformSessionExpiredError();
  }
  return res;
}

/** Reads the standard error envelope ({ error: { message, request_id } }) into a single display string. */
export async function readPlatformError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; request_id?: string } } | null;
  const message = body?.error?.message || fallback;
  return body?.error?.request_id ? `${message} (request ${body.error.request_id})` : message;
}

/** The standard `{ data, meta }` success envelope. */
export interface PlatformEnvelope<T> {
  data: T;
  meta?: Record<string, unknown> & { timestamp?: string };
}

/** A non-2xx platform response, with the fields the console shows (code, message, request id, details). */
export class PlatformApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

async function toApiError(res: Response): Promise<PlatformApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; request_id?: string; details?: Record<string, unknown> };
  } | null;
  return new PlatformApiError(
    res.status,
    body?.error?.code || `HTTP_${res.status}`,
    body?.error?.message || `Request failed with status ${res.status}.`,
    body?.error?.request_id,
    body?.error?.details
  );
}

/** GET/POST/PATCH/DELETE a platform route and return its envelope; throws PlatformApiError on any non-2xx. */
export async function platformRequest<T>(
  url: string,
  init: RequestInit & { json?: unknown } = {},
  stepUpToken?: string | null
): Promise<PlatformEnvelope<T>> {
  const { json, ...rest } = init;
  const res = await platformFetch(
    url,
    json === undefined ? { cache: "no-store", ...rest } : { cache: "no-store", ...rest, body: JSON.stringify(json) },
    stepUpToken
  );
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as PlatformEnvelope<T>;
}
