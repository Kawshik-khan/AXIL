/**
 * Eval gate (production readiness R5): runs the golden dataset through the router and the agent runtime in simulation
 * mode and fails when any score is below evals/thresholds.json. It uses the offline demo AI (AI_DEMO_MODE=1), so it
 * costs nothing and needs no network; it guards routing, handoff and policy behaviour against regressions, not the
 * quality of a live model (run tests/ai-tests.ts with TEST_LLM_LIVE=1 for that).
 * Run: npm run test:eval        Print current scores as JSON: EVAL_PRINT=1 npm run test:eval
 */
process.env.AI_DEMO_MODE = "1";

import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { EvaluationService } from "@/domains/ai/eval/evaluation.service";
import { GOLDEN_DATASET } from "@/domains/ai/eval/golden-dataset";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";

interface Thresholds {
  min_pass_rate: number;
  min_intent_accuracy: number;
  min_tool_selection_accuracy: number;
  min_grounding_rate: number;
  min_handoff_accuracy: number;
  max_policy_violation_rate: number;
  min_cases: number;
}

async function main(): Promise<void> {
  db.clearAllForTesting();
  const stamp = Date.now();
  const owner = await AuthService.registerTenantWithOwner({
    workspaceName: `Eval Gate ${stamp}`,
    name: "Eval Owner",
    email: `eval-${stamp}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });
  db.ensureDefaultSeed(owner.tenant.id);
  const context: RequestContext = {
    requestId: "req_eval_gate",
    traceId: "tr_eval_gate",
    user: { id: owner.user.id, email: owner.user.email, name: owner.user.name, status: "ACTIVE" },
    tenant: { id: owner.tenant.id, name: owner.tenant.name, slug: owner.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };

  const result = await EvaluationService.evaluateAgent(context, GOLDEN_DATASET);
  const scores = {
    cases: result.total_cases,
    pass_rate: Math.round((result.passed_cases / result.total_cases) * 1000) / 10,
    intent_accuracy: result.intent_accuracy,
    tool_selection_accuracy: result.tool_selection_accuracy,
    grounding_rate: result.grounding_rate,
    handoff_accuracy: result.handoff_accuracy,
    policy_violation_rate: result.policy_violation_rate,
  };
  console.log(JSON.stringify({ eval_scores: scores }));
  if (process.env.EVAL_PRINT === "1") return;

  const t = JSON.parse(fs.readFileSync(path.join(process.cwd(), "evals", "thresholds.json"), "utf8")) as Thresholds;
  const problems: string[] = [];
  const atLeast = (name: string, actual: number, min: number) => { if (!(actual >= min)) problems.push(`${name} ${actual} is below the threshold ${min}`); };
  atLeast("cases", scores.cases, t.min_cases);
  atLeast("pass_rate", scores.pass_rate, t.min_pass_rate);
  atLeast("intent_accuracy", scores.intent_accuracy, t.min_intent_accuracy);
  atLeast("tool_selection_accuracy", scores.tool_selection_accuracy, t.min_tool_selection_accuracy);
  atLeast("grounding_rate", scores.grounding_rate, t.min_grounding_rate);
  atLeast("handoff_accuracy", scores.handoff_accuracy, t.min_handoff_accuracy);
  if (!(scores.policy_violation_rate <= t.max_policy_violation_rate)) problems.push(`policy_violation_rate ${scores.policy_violation_rate} is above the maximum ${t.max_policy_violation_rate}`);
  if (problems.length) {
    console.error(`EVAL GATE FAILED:\n  ${problems.join("\n  ")}`);
    for (const f of result.failures.slice(0, 10)) console.error(`  case ${f.test_id}: ${f.reason}`);
    process.exit(1);
  }
  console.log("EVAL GATE PASSED");
}

main().catch((err) => {
  console.error("Eval gate error:", err);
  process.exit(1);
});
