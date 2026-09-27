import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

const KillSwitchSchema = z.object({
  active: z.boolean(),
});

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = await request.json();
    const validated = KillSwitchSchema.parse(body);

    const result = marketingService.toggleKillSwitch(context.tenant.id, validated.active);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
