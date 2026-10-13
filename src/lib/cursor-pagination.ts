/**
 * CommerceOS — Reusable Keyset (Cursor) Pagination Utility
 *
 * Provides high-efficiency, constant-time (O(log N)) pagination over Neon PostgreSQL
 * and in-memory stores without scan-and-discard OFFSET penalties.
 */
import { z } from "zod";

export interface CursorPayload {
  /** ISO-8601 UTC timestamp of record creation */
  c: string;
  /** Unique primary key identifier */
  i: string;
}

export const CursorQuerySchema = z.object({
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CursorQueryParams = z.infer<typeof CursorQuerySchema>;

export interface CursorPaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
}

export interface CursorPaginatedResult<T> {
  items: T[];
  pagination: CursorPaginationMeta;
  /** Optional total count if specifically computed, null or omitted for pure on-demand cursor queries */
  total?: number;
}

/**
 * Encodes record coordinates into a URL-safe Base64URL cursor token.
 */
export function encodeCursor(createdAt: string, id: string): string {
  const payload: CursorPayload = { c: createdAt, i: id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Decodes and validates a Base64URL cursor token.
 * Returns null if the token is missing, malformed, or invalid.
 */
export function decodeCursor(cursor?: string | null): CursorPayload | null {
  if (!cursor || typeof cursor !== "string" || cursor.trim().length === 0) {
    return null;
  }
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.c === "string" && typeof parsed.i === "string") {
      return { c: parsed.c, i: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds standard Keyset WHERE condition parameters for PostgreSQL.
 * For DESC order (newest first): WHERE (created_at < $cursorCreatedAt OR (created_at = $cursorCreatedAt AND id < $cursorId))
 * Compatible with B-Tree composite index on (created_at DESC, id DESC).
 */
export function buildKeysetClause(
  cursor: CursorPayload | null,
  paramStartIndex: number
): { sqlClause: string; params: unknown[]; nextParamIndex: number } {
  if (!cursor) {
    return {
      sqlClause: "",
      params: [],
      nextParamIndex: paramStartIndex,
    };
  }

  const p1 = paramStartIndex;
  const p2 = paramStartIndex + 1;

  // Tuple comparison in Postgres: (created_at, id) < ($1, $2)
  return {
    sqlClause: ` AND (created_at, id) < ($${p1}::timestamptz, $${p2}::text)`,
    params: [cursor.c, cursor.i],
    nextParamIndex: paramStartIndex + 2,
  };
}

/**
 * In-memory fallback helper for test suites and offline mock stores.
 * Evaluates cursor pagination over in-memory arrays keeping identical contracts.
 */
export function sliceForCursor<T extends { id: string; created_at: string }>(
  items: readonly T[],
  limit: number,
  cursor?: string | null
): CursorPaginatedResult<T> {
  const decoded = decodeCursor(cursor);

  let startIndex = 0;
  if (decoded) {
    // Find the item matching the cursor
    const foundIndex = items.findIndex(
      (item) => item.id === decoded.i && item.created_at === decoded.c
    );
    if (foundIndex !== -1) {
      startIndex = foundIndex + 1;
    } else {
      // Fallback: seek by timestamp
      const targetTime = new Date(decoded.c).getTime();
      const byTimeIndex = items.findIndex((item) => {
        const itemTime = new Date(item.created_at).getTime();
        return itemTime < targetTime || (itemTime === targetTime && item.id < decoded.i);
      });
      startIndex = byTimeIndex !== -1 ? byTimeIndex : items.length;
    }
  }

  const sliced = items.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < items.length;

  let nextCursor: string | null = null;
  if (hasMore && sliced.length > 0) {
    const last = sliced[sliced.length - 1];
    nextCursor = encodeCursor(last.created_at, last.id);
  }

  return {
    items: sliced,
    pagination: {
      next_cursor: nextCursor,
      has_more: hasMore,
      limit,
    },
    total: items.length,
  };
}
