import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { strategyEngineService } from "@/domains/autonomous/services";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await Promise.resolve(params);
    const body = await request.json().catch(() => ({}));

    let strategy = strategyEngineService.getStrategies(context.tenant.id).find((s) => s.objective_id === id);
    if (!strategy) {
      strategy = strategyEngineService.createStrategy({
        id: `strat_${Date.now()}`,
        tenant_id: context.tenant.id,
        objective_id: id,
        name: body.name || `Strategy for objective ${id}`,
        description: body.description || "Auto-generated strategy candidate",
        status: "DRAFT",
        version: 1,
        domains_involved: body.domains || ["COMMERCE", "OPERATIONS"],
        plan: {
          steps: [
            { order: 1, domain: "OPERATIONS", action: "AUDIT_INVENTORY", parameters: {}, depends_on: [], estimated_duration_ms: 5000 },
            { order: 2, domain: "COMMERCE", action: "ADJUST_PRICING", parameters: {}, depends_on: [1], estimated_duration_ms: 8000 },
          ],
          expected_duration_ms: 13000,
          estimated_cost_bdt: body.estimated_cost_bdt || 15000,
        },
        constraints: [],
        created_by: context.user?.id || "admin",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const simulation = strategyEngineService.simulateStrategy(context.tenant.id, strategy.id);
    const tradeoffs = strategyEngineService.evaluateTradeoffs(context.tenant.id, strategy.id);

    return apiSuccess({ strategy, simulation, tradeoffs });
  } catch (err) {
    return apiError(err);
  }
}
