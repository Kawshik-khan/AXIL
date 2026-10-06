import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { assertJobToken } from "@/domains/jobs/job-token";
import { JOBS, JobsService } from "@/domains/jobs/jobs.service";
import { withStore } from "@/lib/store-unit";

const JobName = z.enum(Object.keys(JOBS) as [string, ...string[]]);

/**
 * Runs one scheduled job for the current time bucket (FX-99 Part B). Called by n8n schedules with the platform job
 * token; `Idempotency-Key: <job>:<anything>` is required. Workspaces and recipients come from CommerceOS, never from
 * the caller: the body is ignored.
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  try {
    assertJobToken(request);
    const parsed = JobName.safeParse((await params).job);
    if (!parsed.success) throw new ValidationError("Unknown job.");
    const job = parsed.data;
    const key = request.headers.get("idempotency-key") ?? "";
    if (!key.startsWith(`${job}:`) || key.length > 200) throw new ValidationError(`Send an Idempotency-Key header starting with "${job}:".`);
    await enforceRateLimit(`jobs:${job}`, 30, MINUTE);
    return apiSuccess(await JobsService.run(job, key));
  } catch (err) {
    return apiError(err);
  }
}

// Jobs may call out (embeddings) and write in their own short units, so the request doesn't hold the store lock
export const POST = withStore("POST", handlePOST, { unit: false });
