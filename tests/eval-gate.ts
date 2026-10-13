/**
 * Eval gate (production readiness R5): runs the golden dataset through the router and the agent runtime in simulation
 * mode and fails when any score is below evals/thresholds.json. Default is deterministic/offline; set
 * TEST_LLM_LIVE=1 (or use npm run test:eval:live) to evaluate the configured real provider.
 * Run: npm run test:eval | npm run test:eval:live
 */
const liveEvaluation = process.env.TEST_LLM_LIVE === "1";
if (!liveEvaluation) process.env.AI_DEMO_MODE = "1";

import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { EvaluationService } from "@/domains/ai/eval/evaluation.service";
import { GOLDEN_DATASET } from "@/domains/ai/eval/golden-dataset";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { ProductService } from "@/domains/catalog/product.service";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { modelRouter } from "@/domains/ai/providers/model-router";

interface Thresholds {
  min_pass_rate: number;
  min_intent_accuracy: number;
  min_agent_accuracy: number;
  min_execution_success_rate: number;
  min_tool_selection_accuracy: number;
  min_grounding_rate: number;
  min_handoff_accuracy: number;
  max_policy_violation_rate: number;
  min_cases: number;
}

async function main(): Promise<void> {
  // Imports initialize the singleton before main runs. Offline mode is deliberately forced for repeatability;
  // live mode preserves the configured provider and fails closed instead of silently evaluating the demo mock.
  if (liveEvaluation) {
    const status = modelRouter.getStatus();
    if (status.mode !== "LIVE") {
      throw new Error("Live eval requested, but no live LLM_BASE_URL provider is configured.");
    }
    console.log(`Live eval provider: ${status.provider} / ${status.models.TIER_1_FAST}`);
  } else {
    modelRouter.configure({
      ...process.env,
      AI_DEMO_MODE: "1",
      LLM_BASE_URL: undefined,
      LLM_FALLBACK_BASE_URL: undefined,
      LLM_EMBEDDING_BASE_URL: undefined,
    });
    console.log("Eval provider: DEMO / offline deterministic regression gate");
  }
  db.clearAllForTesting();
  const stamp = Date.now();
  const owner = await AuthService.registerTenantWithOwner({
    workspaceName: `Eval Gate ${stamp}`,
    name: "Eval Owner",
    email: `eval-${stamp}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });
  const context: RequestContext = {
    requestId: "req_eval_gate",
    traceId: "tr_eval_gate",
    user: { id: owner.user.id, email: owner.user.email, name: owner.user.name, status: "ACTIVE" },
    tenant: { id: owner.tenant.id, name: owner.tenant.name, slug: owner.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };

  // Give the benchmark tenant explicit, authoritative catalog and policy fixtures.
  // The model must not pass a grounding case by guessing facts absent from its tenant data.
  await ProductService.createProduct(context, {
    name: "Eval জুতা",
    sku: `EVAL-SHOE-${stamp}`,
    base_price: 2500,
    variants: [{ title: "Black / Size 42", sku: `EVAL-SHOE-42-${stamp}`, price: 2500, initial_stock: 12 }],
  });
  await ProductService.createProduct(context, {
    name: "Eval Black T-Shirt",
    sku: `EVAL-TEE-${stamp}`,
    base_price: 1200,
    initial_stock: 8,
  });
  await KnowledgeService.ingestDocument(context, {
    title: "Evaluation delivery coverage policy",
    document_type: "SHIPPING_POLICY",
    language: "en",
    tags: ["delivery", "shipping", "outside Dhaka", "charge"],
    raw_content: "# Delivery coverage\nDelivery is available inside and outside Dhaka. ঢাকার বাহিরে ডেলিভারি চার্জ and ঢাকার বাইরে ডেলিভারি চার্জ must be calculated from the tenant's current delivery settings; this guide does not define prices.",
  });
  await KnowledgeService.ingestDocument(context, {
    title: "Evaluation return and exchange policy",
    document_type: "RETURN_POLICY",
    language: "en",
    tags: ["return", "exchange", "size"],
    raw_content: "# Return and exchange policy\nCustomers may request a size exchange within seven days if the product is unused and has its original tags. Contact support with the order number. Eligibility is confirmed by staff; a return is not automatically approved.",
  });
  await KnowledgeService.ingestDocument(context, {
    title: "Evaluation T-shirt size guide",
    document_type: "SIZE_GUIDE",
    language: "en",
    tags: ["size", "chest", "measurement", "t-shirt"],
    raw_content: "# T-shirt size guide\nSize L has a chest measurement of 42 inches. Measurements can vary slightly by product. Check the product label or ask support if a specific item's chart is needed.",
  });

  const result = await EvaluationService.evaluateAgent(context, GOLDEN_DATASET);
  const scores = {
    cases: result.total_cases,
    pass_rate: Math.round((result.passed_cases / result.total_cases) * 1000) / 10,
    intent_accuracy: result.intent_accuracy,
    agent_accuracy: result.agent_accuracy,
    execution_success_rate: result.execution_success_rate,
    tool_selection_accuracy: result.tool_selection_accuracy,
    grounding_rate: result.grounding_rate,
    handoff_accuracy: result.handoff_accuracy,
    policy_violation_rate: result.policy_violation_rate,
  };
  console.log(JSON.stringify({ eval_scores: scores }));
  if (process.env.EVAL_PRINT === "1") {
    for (const failure of result.failures) {
      console.log(`${failure.test_id}: ${failure.reason}; actual=${JSON.stringify(failure.actual)}`);
    }
    return;
  }

  const t = JSON.parse(fs.readFileSync(path.join(process.cwd(), "evals", "thresholds.json"), "utf8")) as Thresholds;
  const problems: string[] = [];
  const atLeast = (name: string, actual: number, min: number) => { if (!(actual >= min)) problems.push(`${name} ${actual} is below the threshold ${min}`); };
  atLeast("cases", scores.cases, t.min_cases);
  atLeast("pass_rate", scores.pass_rate, t.min_pass_rate);
  atLeast("intent_accuracy", scores.intent_accuracy, t.min_intent_accuracy);
  atLeast("agent_accuracy", scores.agent_accuracy, t.min_agent_accuracy);
  atLeast("execution_success_rate", scores.execution_success_rate, t.min_execution_success_rate);
  atLeast("tool_selection_accuracy", scores.tool_selection_accuracy, t.min_tool_selection_accuracy);
  atLeast("grounding_rate", scores.grounding_rate, t.min_grounding_rate);
  atLeast("handoff_accuracy", scores.handoff_accuracy, t.min_handoff_accuracy);
  if (!(scores.policy_violation_rate <= t.max_policy_violation_rate)) problems.push(`policy_violation_rate ${scores.policy_violation_rate} is above the maximum ${t.max_policy_violation_rate}`);
  if (problems.length) {
    console.error(`EVAL GATE FAILED:\n  ${problems.join("\n  ")}`);
    for (const f of result.failures.slice(0, 10)) console.error(`  case ${f.test_id}: ${f.reason}; actual=${JSON.stringify(f.actual)}`);
    process.exit(1);
  }
  console.log("EVAL GATE PASSED");
}

main().catch((err) => {
  console.error("Eval gate error:", err);
  process.exit(1);
});
