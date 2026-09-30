import { db } from "@/infrastructure/db";
import { apiError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { envNumber } from "@/lib/env-number";
import { logger } from "@/lib/logger";

type RouteHandler<A extends unknown[]> = (...args: A) => Promise<Response>;

/** A request body larger than this is refused (413) before it can hold anything up. */
const MAX_BODY_BYTES = envNumber("STORE_MAX_BODY_BYTES", 20 * 1024 * 1024, 1);
/** A request body that takes longer than this to arrive is refused (408). */
const BODY_READ_TIMEOUT_MS = envNumber("STORE_BODY_READ_TIMEOUT_MS", 15_000, 1);

/**
 * Receives the whole body before the request queues for the store lock, so a slow or huge upload never holds up other
 * requests' writes (security review of FX-45, F1). The handler still reads it normally: `clone()` keeps the received
 * bytes for the original request.
 */
async function receiveBody(request: Request): Promise<void> {
  if (!request.body) return;
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "The request body is too large.", 413);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError("REQUEST_TIMEOUT", "The request body took too long to arrive.", 408)), BODY_READ_TIMEOUT_MS);
  });
  try {
    const body = await Promise.race([request.clone().arrayBuffer(), timeout]);
    if (body.byteLength > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "The request body is too large.", 413);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every API route handler runs through this (ADR-109, FIX_IMPLEMENTATION_PLAN FX-45).
 *
 * - GET: other app servers' changes are synced first when the last sync is older than STORE_SYNC_INTERVAL_MS; a server
 *   that couldn't sync for STORE_MAX_STALENESS_MS answers 503 instead of serving stale sessions and permissions.
 * - POST / PUT / PATCH / DELETE: the body is received first, then the handler is one unit of work. It starts from the
 *   latest committed state, and its changes are committed to Postgres before the response is returned when the response
 *   is a success (status < 400); an error response or a thrown error undoes them (except rows marked with
 *   `db.keepEvenIfRequestFails`). If another server changed the same record first, or a data rule refuses the change,
 *   the caller gets 409 and nothing is saved; if the database is down or this server's writes are backed up, 503.
 *
 * - `{ unit: false }` (a POST that mostly calls another server: a connector test, a webhook target check): the handler
 *   runs outside the store lock like a read, so a slow external host can't hold up other requests' writes (ADR-110,
 *   Phase 5 review H1). It must save through its own short `db.unit(...)`; anything else it changes is committed later
 *   by the background loop and is not undone on an error response.
 *
 * Without Postgres persistence (tests, the JSON file) both simply call the handler.
 */
function withStoreUnit<A extends unknown[]>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  handler: RouteHandler<A>,
  options: { unit?: boolean } = {}
): RouteHandler<A> {
  if (method !== "GET" && options.unit === false) {
    return async (...args: A) => {
      try {
        if (args[0] instanceof Request) await receiveBody(args[0]);
        await db.syncIfDue();
      } catch (err) {
        return apiError(err);
      }
      return handler(...args);
    };
  }
  if (method === "GET") {
    return async (...args: A) => {
      try {
        await db.syncIfDue();
      } catch (err) {
        return apiError(err);
      }
      return handler(...args);
    };
  }
  return async (...args: A) => {
    try {
      if (args[0] instanceof Request) await receiveBody(args[0]);
      return await db.unit(() => handler(...args), (response) => response.status < 400);
    } catch (err) {
      return apiError(err);
    }
  };
}

/**
 * One log line per API request (method, path prefix, status, duration), so the platform log shows activity.
 * On in production (ACCESS_LOG=0 turns it off, ACCESS_LOG=1 turns it on elsewhere). Health probes are skipped.
 * Only the first four path segments are logged (/api/v1/<resource>) and never the query string: ids, invitation
 * tokens and search terms can be secrets or personal data, and this line must carry neither.
 */
function accessLogEnabled(): boolean {
  const flag = process.env.ACCESS_LOG;
  if (flag === "0") return false;
  return flag === "1" || process.env.NODE_ENV === "production";
}

function logRequest(request: unknown, status: number, startedAt: number): void {
  if (!accessLogEnabled() || !(request instanceof Request)) return;
  const path = new URL(request.url).pathname;
  if (path.startsWith("/health")) return;
  logger.info("http.request", {
    method: request.method,
    // split("/") starts with an empty string, so four pieces are "", "api", "v1" and the resource
    path: path.split("/").slice(0, 4).join("/"),
    status,
    duration_ms: Date.now() - startedAt,
  });
}

export function withStore<A extends unknown[]>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  handler: RouteHandler<A>,
  options: { unit?: boolean } = {}
): RouteHandler<A> {
  const inner = withStoreUnit(method, handler, options);
  return async (...args: A) => {
    const startedAt = Date.now();
    try {
      const response = await inner(...args);
      logRequest(args[0], response.status, startedAt);
      return response;
    } catch (err) {
      logRequest(args[0], 500, startedAt);
      throw err;
    }
  };
}
