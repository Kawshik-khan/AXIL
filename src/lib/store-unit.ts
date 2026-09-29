import { db } from "@/infrastructure/db";
import { apiError } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { envNumber } from "@/lib/env-number";

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
 * Without Postgres persistence (tests, the JSON file) both simply call the handler.
 */
export function withStore<A extends unknown[]>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", handler: RouteHandler<A>): RouteHandler<A> {
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
