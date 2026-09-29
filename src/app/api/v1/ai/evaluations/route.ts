import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { EvaluationService } from "@/domains/ai/eval/evaluation.service";
import { GOLDEN_DATASET } from "@/domains/ai/eval/golden-dataset";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_ANALYTICS_READ);

    return apiSuccess({
      golden_dataset_size: GOLDEN_DATASET.length,
      test_cases: GOLDEN_DATASET.map(tc => ({
        id: tc.id,
        category: tc.category,
        language: tc.language,
        input_text: tc.input_text,
        expected_intent: tc.expected_intent,
        expected_agent: tc.expected_agent,
        adversarial: tc.adversarial,
      })),
    });
  } catch (err) {
    return apiError(err);
  }
}

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.AI_SIMULATION_RUN);

    const body = await request.json().catch(() => ({}));
    const testCases = body.test_cases ? body.test_cases : undefined;

    const results = await EvaluationService.evaluateAgent(context, testCases);
    return apiSuccess(results);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
