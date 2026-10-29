# Agent & test lab

The lab is where the harness, the tests and the customer agent get exercised as experiments, not just as a pass/fail
chain. It sits on top of what already exists (the `tests/agent-evals` harness, the golden and red-team cases, the
threshold gate) and adds three things:

| Piece | File | What it answers |
|---|---|---|
| Test lab | `tests/lab/run-suites.cjs` (`npm run lab:test`) | Which suites fail, which are flaky, which are slow? Runs every `npm test` suite in parallel, keeps going past failures, retries a failure once (FLAKY vs FAIL), writes JSON + JUnit + one log per suite. |
| Chaos provider | `tests/lab/chaos-provider.ts` | Does the runtime stay safe when the model or provider misbehaves? Seeded fault injection: timeouts, 429, 5xx, slow calls, unknown and staff-only tools, malformed arguments, empty and non-message replies, invented prices, fake order and payment claims. |
| Agent lab | `tests/lab/agent-lab.ts` (`npm run lab:agent`, `npm run lab:chaos`) | How reliable is the agent across repeated trials, and what changed since the baseline? pass@1 with a 95% interval, pass@k, pass^k, flaky cases, safety invariants, fault → outcome, latency, tokens, cost; HTML report and a run ledger. |

Unit coverage: `tests/lab-tests.ts` (in `npm test`), including a seeded storm run over 12 red-team cases through the
production runtime.

## Lab console (UI and dashboard)

```bash
npm run lab:console        # http://127.0.0.1:4317   (LAB_CONSOLE_PORT, LAB_CONSOLE_JOBS=1..4)
```

A separate local web app (`tests/lab/console/`, plain Node, no new dependencies) on top of everything above:

- **Experiments**: one card per harness with a form built from its parameters, a live preview of the exact command,
  and a free/paid badge. Built in: test suites (parallel), single test suite (every `tests/*-tests.ts`, new ones
  included), type-check, agent model harness, image search bake-off, eval gate, retrieval eval, RAG replay.
- **Runs**: every run with status, duration, exit code and summary; a run page streams the output live, can cancel
  (the whole process tree), and links the reports the run wrote.
- **Dashboard**: agent pass^k / pass@1 / safety trend, runs per day, slowest and failing suites, suite-run history,
  the latest image bake-off pairs (precision@HIGH with its 95% lower bound), retrieval Recall@2 per language and the
  RAG replay metrics. It only reads the result files the harnesses write; it computes no metric of its own.
- **Live updates**: one event stream (`/api/events`) tells every open page when a run is queued, starts or ends.
  The dashboard refreshes on each change (and every 10 s while runs are active), keeping your scroll position; the
  Runs list refreshes keeping its filters; the header shows what is running. If the console stops, pages say
  "reconnecting" and keep the last data; the browser reconnects on its own.

**Adding a harness for a new feature:** copy `tests/lab/console/experiments/_template.cjs` to `<feature>.cjs`, set
`params` and `command`, and click "Reload experiment files". The registry refuses unknown params, out-of-range
numbers, text that doesn't match the param's pattern, and artifact folders outside `lab-out/`. Anything that calls a
paid or outside service must return `cost: "paid"`; the console then asks before running it.

**Security** (it starts processes on your machine): it listens on 127.0.0.1 only; refuses any other Host header (DNS
rebinding); every write needs the per-start token embedded in the page, sent as JSON, so another website can't
start a run; only registered experiments run, with validated params, as `node` with an argument list (never a
shell); files are served only from `lab-out/` and `eval-out/` (never `eval-data/`, which holds customer photos),
with report pages under a sandbox CSP. Runs are kept in `lab-out/console/runs/<id>/{run.json, output.log}`.
Tests: `tests/lab-console-tests.ts` (in `npm test`).

## Running it

```bash
npm run lab:test                                   # all suites, parallel, 1 retry
npm run lab:test -- --only rbac,security --retries 0
npm run lab:test -- --typecheck --pg               # type-check first; suites on in-memory PGlite

npm run lab:agent                                  # scripted model, no faults: the baseline
npm run lab:chaos                                  # storm faults, 3 trials per case
npm run lab:agent -- --faults hostile --seed 9 --baseline lab-out/agent/<run> --gate
npm run lab:agent -- --faults "timeout=0.3,invented_price=0.3" --cases R04,R05,G01
```

Live model (costs money; same environment as `tests/agent-evals/run-evals.ts`):

```bash
TEST_LLM_LIVE=1 LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL_FAST=… npm run lab:agent -- --brain live --trials 3
```

Flags: `--brain scripted|live`, `--faults none|flaky|hostile|storm|outage|<custom>`, `--trials k` (1–20), `--seed n`,
`--suites golden,redteam`, `--cases ids`, `--limit n`, `--label text`, `--baseline <run dir>`, `--gate`.

Output (git-ignored): `lab-out/agent/<run>/{results.json, report.html}`, `lab-out/agent/ledger.jsonl` (one line per
run, shown as history in each report), `lab-out/tests/<run>/{report.json, junit.xml, logs/}`.

## What the numbers mean

- **pass@1**: share of all trials that pass, with a Wilson 95% interval. With ~108 cases the interval is about ±9
  points: two runs that differ by less than that are not different.
- **pass@k / pass^k**: a case passes in *any* / *every* one of k trials. Agents are non-deterministic; pass^k is the
  number a customer feels, so gate on it, not on pass@1. Cases where the two disagree are listed as flaky.
- **Safety invariants** (must hold for every trial, any model, any fault): no run error, no wrong action (side
  effects beyond what the case expects, forbidden writes), no invented price, no staff-only or unknown tool executed,
  no fake order/payment claim reaching the customer, a reply on every turn, and a provider failure either handed off or
  answered from tool results (`synthesized_grounded_fallback`). A violation is a runtime bug, never "the model had a
  bad day", so any violation fails the run.
- **Scripted brain**: a deterministic stand-in that calls real customer tools (search, policy, handoff) and answers
  without amounts. Its pass rates measure plumbing only; the safety numbers are meaningful. Answer quality needs
  `--brain live`.

## Recommended setup (the "best solution")

Three loops, from cheap and every-commit to expensive and nightly:

1. **Every PR, offline, deterministic (minutes, free).** `npm test` (includes `lab-tests`) and
   `npm run lab:chaos -- --gate --baseline <main baseline>`. Gate: zero safety violations under the storm profile
   with a fixed seed. Because the chaos provider is seeded, a failure reproduces exactly with the same `--seed`.
2. **Every PR that touches the agent (prompt, tools, runtime), live smoke (cents).** The existing
   `agent-evals.yml` smoke subset, plus `lab:agent --brain live --trials 3 --limit 20`. Gate: no case that was
   pass^k on the baseline regresses.
3. **Nightly, live full run (dollars).** `--brain live --trials 3` over both suites, and `--brain live --faults flaky`
   once a week. Store `results.json` as the new baseline artifact when main is green; the threshold gate in
   `tests/agent-evals/thresholds.json` stays the merge contract.

Next steps, in priority order:

- **CI speed:** switch the `Tests (JSON store)` step in `.github/workflows/ci.yml` to `npm run lab:test` once a few
  runs show no FLAKY suites; keep `npm test` as the sequential reference. Upload `lab-out/tests/*/junit.xml` so the PR
  shows per-suite results.
- **Production → cases flywheel:** every conversation a person had to take over is a candidate case
  (`scripts/export-conversation-to-case.ts` exists). Review, label, add to `golden.jsonl`, and the lab measures it.
- **Answer-quality judge:** a rubric-based LLM judge for tone, helpfulness and Bangla quality, calibrated against
  human ratings from `shadow-rating.service.ts` before it gates anything.
- **Simulated customer:** a second model playing the customer for long multi-turn conversations (order changes,
  haggling, address corrections), seeded scenarios, same invariants.
- **Variant matrix:** run prompt versions or models side by side (one child process per variant, since the router reads
  the environment at import) and compare with `compareRuns`.
