/**
 * Offline prompt-token report for the customer agent (no model call, no cost). Two parts:
 *
 * 1. Fixed cost per model call: the system prompt and the tool definitions the runtime sends, as characters and as
 *    estimated tokens, for the current prompt and tool set against the v2.4 baseline.
 * 2. With a live results directory (`node tests/ts-runner.cjs ./tests/agent-evals/token-report.ts <results-dir>`): every
 *    recorded turn replayed under each lever in turn, projecting the golden suite's average prompt tokens per turn.
 *    The replay uses only what the result file records (tools, guards, calls, tokens), so it is an estimate; the live
 *    run is the measurement.
 *
 * Token estimate: ASCII characters / 4.5 + other characters / 1.6, scaled so the v2.4 baseline matches the ~3,850
 * prompt tokens of a one-call turn with no history in the 2026-10-20 nightly run (gpt-oss:120b).
 */
import fs from "fs";
import path from "path";
import { CUSTOMER_TOOLS } from "@/domains/ai/customer-agent/tools";
import { PROMPT_FILE } from "@/domains/ai/customer-agent/runtime";

const PROMPTS = path.join(process.cwd(), "src", "domains", "ai", "customer-agent", "prompts");
/** v2.4 with tool set v2 (measured from commit 94412df): what every call sent before the v2.5 change. */
const BASELINE = { prompt: "customer-agent.system.v2.4-cod.md", toolChars: 5521, placeOrderChars: 928 };
const ONE_CALL_TURN_TOKENS = 3850; // live, v2.4, one call, empty history (G51-G54, R13-R15)
const DYNAMIC_CHARS = 700; // <store_context> + <session_state> + a short message, typical for those turns

const raw = (text: string) => {
  let ascii = 0;
  for (const ch of text) if (ch.charCodeAt(0) < 128) ascii++;
  return ascii / 4.5 + (Array.from(text).length - ascii) / 1.6;
};
const SCALE = ONE_CALL_TURN_TOKENS / (raw(fs.readFileSync(path.join(PROMPTS, BASELINE.prompt), "utf8")) + BASELINE.toolChars / 4.5 + DYNAMIC_CHARS / 4.5);
export const estimateTokens = (text: string) => Math.round(raw(text) * SCALE);

export function fixedCost() {
  const prompt = (file: string) => fs.readFileSync(path.join(PROMPTS, file), "utf8");
  const tools = Object.values(CUSTOMER_TOOLS).map((t) => JSON.stringify(t.def));
  const placeOrder = JSON.stringify(CUSTOMER_TOOLS.place_order.def);
  const baselinePrompt = prompt(BASELINE.prompt);
  const currentPrompt = prompt(PROMPT_FILE);
  return {
    baseline: {
      prompt_chars: Array.from(baselinePrompt).length, prompt_tokens: estimateTokens(baselinePrompt),
      tool_chars: BASELINE.toolChars, tool_tokens: Math.round((BASELINE.toolChars / 4.5) * SCALE),
    },
    current: {
      prompt_file: PROMPT_FILE, prompt_chars: Array.from(currentPrompt).length, prompt_tokens: estimateTokens(currentPrompt),
      tool_chars: tools.join("").length, tool_tokens: estimateTokens(tools.join("")),
      place_order_tokens: estimateTokens(placeOrder),
    },
    baseline_place_order_tokens: Math.round((BASELINE.placeOrderChars / 4.5) * SCALE),
  };
}

// ------------------------------------------------------------------------------------------------ replay of a live run
interface Turn { input: string; response: string; tools: Array<{ name: string; ok: boolean; refused?: string }>; guards: string[]; llm_calls: number; prompt_tokens: number; status: string }
interface Result { id: string; turns: Turn[] }

/** Model calls the turn would make under the levers switched on. */
function callsUnder(t: Turn, lv: { serverReplies: boolean; handoffArgs: boolean }): number {
  let calls = t.llm_calls;
  if (lv.handoffArgs) calls -= t.tools.filter((x) => x.name === "handoff_to_human" && x.refused === "INVALID_ARGS").length;
  if (!lv.serverReplies) return Math.max(calls, 0);
  const tools = lv.handoffArgs ? t.tools.filter((x) => !(x.name === "handoff_to_human" && x.refused === "INVALID_ARGS")) : t.tools;
  const handoffAt = tools.findIndex((x) => x.name === "handoff_to_human" && x.ok);
  // One tool per step (what the recorded runs show): the turn ends on the step that handed off
  if (handoffAt >= 0) return handoffAt + 1;
  const last = tools[tools.length - 1];
  const detailsGiven = /01[3-9]\d{8}/.test(t.input); // with name, phone and address the model still writes the reply
  if (t.guards.includes("quote_template") && last?.name === "quote_order" && !detailsGiven) return tools.length;
  if (last?.name === "place_order" && last.ok && /ORD-\d{4}-\d+/.test(t.response) && tools.every((x) => x.name === "place_order")) return tools.length;
  return calls;
}

export function replay(results: Result[]) {
  const f = fixedCost();
  const promptSaving = f.baseline.prompt_tokens - f.current.prompt_tokens;
  const toolSaving = f.baseline.tool_tokens - f.current.tool_tokens;
  const turns = results.flatMap((r) => {
    let quoteOpen = false;
    return r.turns.filter((t) => t.status !== "BLOCKED").map((t) => {
      const before = quoteOpen;
      if (t.tools.some((x) => x.name === "quote_order" && x.ok)) quoteOpen = true;
      if (t.tools.some((x) => x.name === "place_order" && x.ok) && /ORD-\d{4}-\d+/.test(t.response)) quoteOpen = false;
      return { t, quoteOpenAtStart: before };
    });
  });
  const avg = (f: (x: (typeof turns)[number]) => number) => (turns.length ? Math.round(turns.reduce((n, x) => n + f(x), 0) / turns.length) : 0);
  const perCall = (t: Turn) => (t.llm_calls ? t.prompt_tokens / t.llm_calls : 0);
  const steps = [
    { lever: "baseline (recorded)", serverReplies: false, handoffArgs: false, prompt: false, gate: false },
    { lever: "1. server-written replies (quote, handoff, placed)", serverReplies: true, handoffArgs: false, prompt: false, gate: false },
    { lever: "2a. handoff reason/summary never fail", serverReplies: true, handoffArgs: true, prompt: false, gate: false },
    { lever: "2b. place_order offered only with an open quote", serverReplies: true, handoffArgs: true, prompt: false, gate: true },
    { lever: "2c+3. shorter tool descriptions, prompt v2.5", serverReplies: true, handoffArgs: true, prompt: true, gate: true },
  ];
  return steps.map((s) => ({
    lever: s.lever,
    avg_llm_calls_per_turn: Math.round((turns.reduce((n, x) => n + callsUnder(x.t, s), 0) / turns.length) * 100) / 100,
    avg_prompt_tokens_per_turn: avg(({ t, quoteOpenAtStart }) => {
      const calls = callsUnder(t, s);
      // A call's tokens are the turn's recorded average per call, minus what the lever removes from every call
      let each = perCall(t);
      if (s.prompt) each -= promptSaving + toolSaving;
      // The first call of a turn without an open quote has no place_order; later calls may (a quote made this turn)
      if (s.gate && !quoteOpenAtStart) each -= (s.prompt ? f.current.place_order_tokens : f.baseline_place_order_tokens) * (calls ? 1 / calls : 0);
      return calls * each;
    }),
  }));
}

if (process.argv.some((a) => a.endsWith("token-report.ts"))) { // run directly, not imported
  const f = fixedCost();
  console.log("Fixed cost per model call (estimated tokens):");
  console.log(`  baseline ${BASELINE.prompt}: prompt ${f.baseline.prompt_tokens} (${f.baseline.prompt_chars} chars) + tools ${f.baseline.tool_tokens} (${f.baseline.tool_chars} chars) = ${f.baseline.prompt_tokens + f.baseline.tool_tokens}`);
  console.log(`  current  ${f.current.prompt_file}: prompt ${f.current.prompt_tokens} (${f.current.prompt_chars} chars) + tools ${f.current.tool_tokens} (${f.current.tool_chars} chars) = ${f.current.prompt_tokens + f.current.tool_tokens}; without place_order ${f.current.prompt_tokens + f.current.tool_tokens - f.current.place_order_tokens}`);
  const dir = process.argv[process.argv.findIndex((a) => a.endsWith("token-report.ts")) + 1];
  if (dir) {
    for (const suite of ["golden", "redteam"]) {
      const file = path.join(dir, `agent-${suite}.json`);
      if (!fs.existsSync(file)) continue;
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      console.log(`\n${suite} (${j.meta?.prompt_version ?? "?"}, ${j.results.length} cases), projected per lever (cumulative):`);
      for (const row of replay(j.results)) console.log(`  ${row.lever.padEnd(52)} calls/turn ${String(row.avg_llm_calls_per_turn).padStart(4)}   prompt tokens/turn ${row.avg_prompt_tokens_per_turn}`);
    }
  }
}
