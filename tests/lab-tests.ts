/**
 * Agent lab (tests/lab): the chaos provider is reproducible per seed, fault profiles parse, the metrics (pass@k, pass^k,
 * Wilson interval, safety invariants, baseline comparison) compute what they claim, and a short hostile-model run
 * through the production customer-agent runtime breaks no safety invariant.
 */
import assert from "assert";
import type { LLMProvider, LLMToolDefinition } from "@/domains/ai/providers/llm-provider.interface";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { RecordingProvider, loadCases, localEmbedder, runCase, type CaseResult } from "./agent-evals/harness";
import { ChaosProvider, FAULT_PROFILES, ScriptedCustomerModel, parseFaultProfile, seededRandom } from "./lab/chaos-provider";
import { checkInvariants, compareRuns, labSummary, toLabCase, toTrial, wilson, type Trial } from "./lab/lab-metrics";
import { renderReport } from "./lab/lab-report";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(err);
    failed++;
  }
}

function fakeResult(over: Partial<CaseResult> = {}, turn: Partial<CaseResult["turns"][number]> = {}): CaseResult {
  return {
    id: "X1", suite: "golden", category: "c", pass: true, failures: [], side_effects: {}, hallucinated_price: false, wrong_action: false, handoff_observed: false, cost_usd: 0,
    turns: [{ input: "hi", response: "Ji", status: "COMPLETED", tools: [], guards: [], handoff: false, latency_ms: 5, llm_calls: 1, prompt_tokens: 10, completion_tokens: 2, cached_tokens: 0, hallucinated_amounts: [], ...turn }],
    ...over,
  };
}
const trial = (pass: boolean, violated: Trial["violated"] = []): Trial => ({ pass, failures: pass ? [] : ["F"], violated, faults: [], guards: [], statuses: [], latency_ms: 1, tokens: 1, cost_usd: 0 });

async function main() {
  console.log(`\n${BOLD}AGENT LAB${RESET}\n`);

  await runTest("seeded randomness is reproducible and differs by seed", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const xs = [a(), a(), a()];
    assert.deepStrictEqual(xs, [b(), b(), b()]);
    assert.notDeepStrictEqual(xs, [c(), c(), c()]);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
  });

  await runTest("fault profiles: named profiles, custom specs, and bad specs refused", () => {
    assert.deepStrictEqual(parseFaultProfile("outage"), { server_error: 1 });
    assert.deepStrictEqual(parseFaultProfile("timeout=0.2,invented_price=0.5"), { timeout: 0.2, invented_price: 0.5 });
    assert.throws(() => parseFaultProfile("drop_tables=1"), /unknown fault/);
    assert.throws(() => parseFaultProfile("timeout=2"), /between 0 and 1/);
    for (const [name, p] of Object.entries(FAULT_PROFILES)) {
      const total = Object.values(p).reduce((n, x) => n + (x ?? 0), 0);
      assert.ok(total <= 1 + 1e-9, `${name} sums to ${total}`);
    }
  });

  await runTest("the chaos provider injects the same faults for the same seed and logs each one", async () => {
    const inner = new ScriptedCustomerModel(localEmbedder);
    const kinds = async (seed: number) => {
      const p = new ChaosProvider(inner, FAULT_PROFILES.storm, seed, 0);
      p.setScope("s");
      for (let i = 0; i < 40; i++) await p.chat([{ role: "user", content: "black tshirt" }], []).catch(() => undefined);
      return p.take().map((e) => `${e.call}:${e.kind}`);
    };
    const first = await kinds(3);
    assert.deepStrictEqual(first, await kinds(3));
    assert.ok(first.length > 0, "storm injected nothing in 40 calls");
    const outage = new ChaosProvider(inner, FAULT_PROFILES.outage, 1, 0);
    await assert.rejects(() => outage.chat([{ role: "user", content: "x" }]), /503/);
    assert.deepStrictEqual(outage.take().map((e) => e.kind), ["server_error"]);
  });

  await runTest("the scripted model calls a real customer tool first, then answers without amounts", async () => {
    const m = new ScriptedCustomerModel(localEmbedder);
    const tools: LLMToolDefinition[] = ["search_products", "search_policy", "handoff_to_human"].map((name) => ({ name, description: "", parameters: { type: "object", properties: {} } }));
    assert.strictEqual((await m.chat([{ role: "user", content: "kalo tshirt ache?" }], tools)).tool_calls?.[0].name, "search_products");
    assert.strictEqual((await m.chat([{ role: "user", content: "return policy ki?" }], tools)).tool_calls?.[0].name, "search_policy");
    assert.strictEqual((await m.chat([{ role: "user", content: "manush er sathe kotha bolbo" }], tools)).tool_calls?.[0].name, "handoff_to_human");
    const answer = await m.chat([{ role: "user", content: "x" }, { role: "tool", content: "{}", tool_call_id: "1", name: "search_products" }], tools);
    assert.ok(answer.content && !/\d/.test(answer.content));
  });

  await runTest("Wilson interval matches known values and handles empty input", () => {
    assert.strictEqual(wilson(0, 0), null);
    assert.deepStrictEqual(wilson(10, 10), { low: 72.2, high: 100 });
    const w = wilson(50, 100)!;
    assert.ok(Math.abs(w.low - 40.4) < 0.2 && Math.abs(w.high - 59.6) < 0.2, JSON.stringify(w));
  });

  await runTest("safety invariants: each violation is detected, and a provider failure covered by a handoff is not one", () => {
    assert.deepStrictEqual(checkInvariants(fakeResult(), []), []);
    assert.ok(checkInvariants(fakeResult({ hallucinated_price: true }), []).includes("no_invented_price"));
    assert.ok(checkInvariants(fakeResult({ wrong_action: true }), []).includes("no_wrong_action"));
    assert.ok(checkInvariants(fakeResult({}, { tools: [{ name: "verify_payment_transaction", ok: true }] }), []).includes("no_forbidden_tool"));
    assert.ok(checkInvariants(fakeResult({}, { response: "Order number ORD-99999 confirmed" }), []).includes("no_false_claim"));
    assert.ok(checkInvariants(fakeResult({}, { response: " " }), []).includes("always_replies"));
    assert.ok(checkInvariants(fakeResult({}, { status: "ERROR" }), []).includes("no_run_error"));
    const failedTurn = { guards: ["provider_failed:LLM_PROVIDER_ERROR"], status: "COMPLETED" };
    assert.ok(checkInvariants(fakeResult({}, failedTurn), ["server_error"]).includes("failure_hands_off"));
    assert.deepStrictEqual(checkInvariants(fakeResult({}, { ...failedTurn, handoff: true }), ["server_error"]), []);
    assert.deepStrictEqual(checkInvariants(fakeResult({}, { ...failedTurn, guards: [...failedTurn.guards, "synthesized_grounded_fallback"] }), ["server_error"]), []);
  });

  await runTest("pass@k, pass^k, flaky cases and the baseline comparison", () => {
    const base = [toLabCase("A", "golden", "c", [trial(true), trial(true)]), toLabCase("B", "golden", "c", [trial(false), trial(false)]), toLabCase("C", "golden", "c", [trial(true), trial(true)])];
    const now = [toLabCase("A", "golden", "c", [trial(true), trial(false)]), toLabCase("B", "golden", "c", [trial(true), trial(true)]), toLabCase("D", "golden", "c", [trial(true, ["no_invented_price"])])];
    const s = labSummary(now);
    assert.strictEqual(s.pass_at_k, 100);
    assert.strictEqual(s.pass_hat_k, 66.7);
    assert.deepStrictEqual(s.flaky_cases, ["A"]);
    assert.strictEqual(s.invariant_violations.no_invented_price, 1);
    const cmp = compareRuns("base", base, now, labSummary(base), s);
    assert.deepStrictEqual(cmp.regressed, ["golden/A"]);
    assert.deepStrictEqual(cmp.fixed, ["golden/B"]);
    assert.deepStrictEqual(cmp.missing, ["golden/C"]);
    assert.strictEqual(cmp.deltas.pass_hat_k.delta, 0);
  });

  await runTest("the report escapes case text and renders with no scripts", () => {
    const c = toLabCase("<img onerror=x>", "golden", "<b>", [{ ...trial(false), failures: ['MUST_MATCH /"<script>"/'] }]);
    const html = renderReport({ meta: { run: "r", brain: "scripted" }, summary: labSummary([c]), quality: {}, cases: [c] }, [{ run: "<x>" }]);
    assert.ok(!html.includes("<script"), "unescaped script tag");
    assert.ok(!html.includes("<img onerror"), "unescaped case id");
    assert.ok(html.includes("&lt;img onerror=x&gt;"));
  });

  await runTest("a hostile model through the production runtime breaks no safety invariant (seeded, 12 red-team cases)", async () => {
    const chaos = new ChaosProvider(new ScriptedCustomerModel(localEmbedder), FAULT_PROFILES.storm, 11, 0);
    modelRouter.setPrimaryProvider(new RecordingProvider(chaos));
    modelRouter.setFallbackProvider(null);
    (modelRouter as unknown as { embeddingProvider: LLMProvider }).embeddingProvider = localEmbedder;
    const problems: string[] = [];
    let injected = 0;
    for (const c of loadCases("redteam", null, 12)) {
      modelRouter.resetCircuitBreakers();
      const r = await runCase("redteam", c);
      const faults = chaos.take().map((e) => e.kind);
      injected += faults.length;
      const t = toTrial(r, faults);
      if (t.violated.length) problems.push(`${c.id} [${faults.join(",")}]: ${t.violated.join(",")} ${t.failures.join("; ").slice(0, 160)}`);
    }
    assert.ok(injected > 0, "no fault was injected");
    assert.deepStrictEqual(problems, []);
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
