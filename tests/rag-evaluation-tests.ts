// @ts-nocheck
import assert from "assert";
import { evaluateRagQuality } from "@/domains/ai/eval/rag-evaluation";
import { validateRagQualityDataset } from "@/domains/ai/eval/rag-quality-dataset";

let passed = 0;
let failed = 0;
function test(name: string, run: () => void) {
  try { run(); passed++; console.log(`  ✓ PASS - ${name}`); }
  catch (error) { failed++; console.error(`  ✗ FAIL - ${name}`, error); }
}

const cases = [
  { id: "A", query: "fee?", language: "en", category: "FULFILLMENT", answerability: "ANSWERABLE", relevant_sections: ["Delivery"] },
  { id: "B", query: "weather?", language: "bn", category: "OFF_TOPIC", answerability: "UNANSWERABLE", relevant_sections: [] },
  { id: "C", query: "fee?", language: "banglish", category: "PROVIDER_OUTAGE", answerability: "RETRIEVAL_UNAVAILABLE", relevant_sections: [] },
];
const observations = [
  { case_id: "A", ranked_sections: [], abstained: true, factual_claims: 0, supported_claims: 0 },
  { case_id: "B", ranked_sections: [], abstained: true },
  { case_id: "C", ranked_sections: [], abstained: true, retrieval_unavailable: true },
];

test("dataset validator rejects duplicate IDs and missing answerable qrels", () => {
  assert.throws(() => validateRagQualityDataset([cases[0], cases[0]]), /duplicate case ID/);
  assert.throws(() => validateRagQualityDataset([{ ...cases[0], relevant_sections: [] }]), /at least one relevant section/);
});

test("retrieval outage is measured separately from correct abstention", () => {
  const metrics = evaluateRagQuality(cases, observations, 5);
  assert.strictEqual(metrics.correct_abstention_rate, 1);
  assert.strictEqual(metrics.provider_unavailable_cases, 1);
  assert.strictEqual(metrics.answerable_coverage, 0);
  assert.strictEqual(metrics.false_answer_count, 0);
  assert.strictEqual(metrics.by_language.en.recall_at_5, 0);
  assert.strictEqual(metrics.by_language.bn.correct_abstention_rate, 1);
  assert.strictEqual(metrics.by_category.OFF_TOPIC.answerable_coverage, null, "No answerable examples must be N/A, not 100%.");
  assert.strictEqual(metrics.denominators.answerable_cases, 1);
  assert.strictEqual(metrics.denominators.abstention_cases, 1, "Provider outage is not an expected abstention case.");
});

test("evaluator rejects missing, duplicate, and foreign observations", () => {
  assert.throws(() => evaluateRagQuality(cases, observations.slice(1), 5), /exactly one observation/);
  assert.throws(() => evaluateRagQuality(cases, [...observations, observations[0]], 5), /unique IDs/);
  assert.throws(() => evaluateRagQuality(cases, [...observations.slice(1), { ...observations[0], case_id: "OTHER" }], 5), /exist in the evaluation set/);
});

console.log(`RAG evaluator tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
