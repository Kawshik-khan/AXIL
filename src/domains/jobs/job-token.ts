/**
 * The platform job token (FX-99 Part B): the only credential `POST /api/v1/jobs/{job}/run` accepts, and it does
 * nothing else (scope `jobs.run`). n8n holds the token; the server holds only its SHA-256 (JOBS_TOKEN_SHA256, hex), so
 * the environment never contains the secret itself. Unset: the job endpoints are off.
 */
import crypto from "crypto";
import { AppError, AuthenticationError } from "@/lib/errors";

export function assertJobToken(request: Request, env: NodeJS.ProcessEnv = process.env): void {
  const expected = (env.JOBS_TOKEN_SHA256 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new AppError("JOBS_NOT_CONFIGURED", "Scheduled jobs are not configured on this server.", 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token.length < 32) throw new AuthenticationError("A job token is required.");
  const presented = crypto.createHash("sha256").update(token, "utf8").digest();
  if (!crypto.timingSafeEqual(presented, Buffer.from(expected, "hex"))) {
    throw new AuthenticationError("The job token is invalid.");
  }
}
