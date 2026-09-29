import { db } from "@/infrastructure/db";
import { apiError } from "@/lib/api-response";

type RouteHandler<A extends unknown[]> = (...args: A) => Promise<Response>;

/**
 * Every API route handler runs through this (ADR-109, FIX_IMPLEMENTATION_PLAN FX-45).
 *
 * - GET: other app servers' changes are synced first when the last sync is older than STORE_SYNC_INTERVAL_MS.
 * - POST / PUT / PATCH / DELETE: the handler is one unit of work. It starts from the latest committed state, and its
 *   changes are committed to Postgres before the response is returned when the response is a success (status < 400);
 *   an error response or a thrown error undoes them. If another server changed the same record first, or a data rule
 *   refuses the change, the caller gets 409 and nothing is saved; if the database is down, 503.
 *
 * Without Postgres persistence (tests, the JSON file) both simply call the handler.
 */
export function withStore<A extends unknown[]>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", handler: RouteHandler<A>): RouteHandler<A> {
  if (method === "GET") {
    return async (...args: A) => {
      await db.syncIfDue();
      return handler(...args);
    };
  }
  return async (...args: A) => {
    try {
      return await db.unit(() => handler(...args), (response) => response.status < 400);
    } catch (err) {
      return apiError(err);
    }
  };
}
