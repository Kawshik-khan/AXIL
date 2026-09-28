import { z } from "zod";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { autonomousCyclesService } from "@/domains/autonomous/services";

const Body = z.object({ cycle_type: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY") }).strict();

/**
 * Starts an autonomous cycle by hand (FX-33 #2: the Control Tower button called a route that doesn't exist and said
 * it had run). The cycle is recorded at its first step; no worker executes the steps yet, and the response says so.
 * Refused while autonomy is halted.
 */
export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AUTONOMOUS_EXECUTE);
    enforceRateLimit(`autonomous-cycle:tenant:${context.tenant.id}`, 5, 60_000);
    const body = Body.parse(await request.json().catch(() => ({})));
    const run =
      body.cycle_type === "WEEKLY"
        ? autonomousCyclesService.startWeeklyCycle(context.tenant.id, "MANUAL")
        : body.cycle_type === "MONTHLY"
          ? autonomousCyclesService.startMonthlyCycle(context.tenant.id, "MANUAL")
          : autonomousCyclesService.startDailyCycle(context.tenant.id, "MANUAL");
    return apiSuccess(
      { run, executed: false, note: "Cycle recorded at its first step. No autonomous worker runs cycle steps yet." },
      undefined,
      201
    );
  } catch (err) {
    return apiError(err);
  }
}
