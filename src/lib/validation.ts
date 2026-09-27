import { z, ZodTypeAny } from "zod";
import { ValidationError } from "@/lib/errors";

/**
 * Parses request input with a Zod schema or throws a 400 ValidationError listing the issues (FX-12).
 * Use `.strict()` schemas for updates so unknown keys (tenant_id, id, status, created_at, …) are rejected
 * instead of being merged into stored records (audit H4).
 */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Request body is invalid.", {
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return result.data;
}

/** Reads a JSON body; a missing or malformed body becomes `{}` so the schema reports what is missing. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
