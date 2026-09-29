import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { simulationService } from "@/domains/intelligence/services/simulation.service";
import { SimulationInput, SimulationScenarioType } from "@/types/intelligence";
import { withStore } from "@/lib/store-unit";

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const body = await request.json();

    const scenarioName: string = body.scenario_name || "Custom Scenario Simulation";
    const inputs: SimulationInput = body.inputs || {};
    const scenarioType: SimulationScenarioType = body.scenario_type || "CUSTOM";

    const result = simulationService.simulateScenario(
      context.tenant.id,
      scenarioName,
      inputs,
      scenarioType
    );

    return apiSuccess({ simulation: result });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
