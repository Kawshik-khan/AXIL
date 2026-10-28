/**
 * Agent lab: one self-contained HTML page per run (no scripts, no network): headline metrics, safety invariants,
 * fault → outcome table, baseline comparison, run history from the ledger, and every case's trials.
 */
import type { Comparison, LabCase, LabSummary } from "./lab-metrics";

interface Result { meta: Record<string, unknown>; summary: LabSummary; quality: Record<string, Record<string, unknown>>; comparison?: Comparison; cases: LabCase[] }

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? String(v) : esc(v));

function tile(label: string, value: unknown, tone: "ok" | "bad" | "plain" = "plain", sub = "") {
  return `<div class="tile ${tone}"><div class="label">${esc(label)}</div><div class="value">${fmt(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}
function table(head: string[], rows: unknown[][]) {
  if (!rows.length) return `<p class="muted">None.</p>`;
  return `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderReport(r: Result, history: Array<Record<string, unknown>>): string {
  const s = r.summary;
  const m = r.meta;
  const unsafe = Object.keys(s.invariant_violations).length > 0;
  const live = m.brain === "live";
  const ci = s.pass_at_1_ci95 ? `95% CI ${s.pass_at_1_ci95.low}–${s.pass_at_1_ci95.high}` : "";

  const faultRows = Object.entries(s.faults).sort((a, b) => b[1].injected - a[1].injected).map(([k, v]) => [esc(k), v.injected, v.trials, v.unsafe_trials ? `<span class="bad-text">${v.unsafe_trials}</span>` : "0"]);
  const violationRows = Object.entries(s.invariant_violations).map(([k, v]) => [`<span class="bad-text">${esc(k)}</span>`, v]);
  const qualityRows = Object.entries(r.quality).map(([suite, q]) => [esc(suite), fmt(q.pass_rate), fmt(q.hallucinated_price_rate), fmt(q.wrong_action_rate), fmt(q.handoff_accuracy), fmt(q.tool_capability_recall), fmt(q.language_match), fmt(q.p95_turn_latency_ms)]);
  const historyRows = [...history].reverse().map((h) => [esc(h.run), esc(h.label), esc(h.brain), esc(h.faults), fmt(h.trials), fmt(h.pass_at_1), fmt(h.pass_hat_k), fmt(h.safety_rate), fmt(h.violations), esc(String(h.git_sha ?? "").slice(0, 8))]);
  const caseRows = r.cases.map((c) => {
    const marks = c.trials.map((t) => `<span class="mark ${t.violated.length ? "m-bad" : t.pass ? "m-ok" : "m-fail"}" title="${esc([...t.violated, ...t.failures].join("; ") || "pass")}"></span>`).join("");
    const faults = [...new Set(c.trials.flatMap((t) => t.faults))].join(", ");
    const why = [...new Set(c.trials.flatMap((t) => [...t.violated.map((v) => `⚠ ${v}`), ...t.failures]))].slice(0, 4).map(esc).join("<br>");
    return [`<code>${esc(c.suite)}/${esc(c.id)}</code>`, esc(c.category), marks, esc(faults), why ? `<span class="small">${why}</span>` : `<span class="muted">pass</span>`];
  });
  const cmp = r.comparison;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Lab Run</title>
<style>
:root { --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --line: #e4e4df; --ok: #1f7a4d; --bad: #b42318; --warn: #a15c07; --ok-bg: #e8f5ee; --bad-bg: #fdecea; }
@media (prefers-color-scheme: dark) { :root { --bg: #141413; --panel: #1e1e1c; --text: #ecece8; --muted: #9a9a93; --line: #2f2f2c; --ok: #5cc995; --bad: #f2766b; --warn: #e3a64a; --ok-bg: #16291f; --bad-bg: #331a17; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 10px; }
.muted { color: var(--muted); } .small { font-size: 12px; } .bad-text { color: var(--bad); font-weight: 600; }
.meta { color: var(--muted); font-size: 12px; word-break: break-all; }
.banner { margin: 16px 0; padding: 10px 14px; border-radius: 8px; font-weight: 600; }
.banner.ok { background: var(--ok-bg); color: var(--ok); } .banner.bad { background: var(--bad-bg); color: var(--bad); }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.tile .label { font-size: 12px; color: var(--muted); } .tile .value { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; } .tile .sub { font-size: 11px; color: var(--muted); }
.tile.ok .value { color: var(--ok); } .tile.bad .value { color: var(--bad); }
.scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; } tr:last-child td { border-bottom: 0; }
.mark { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 3px; }
.m-ok { background: var(--ok); } .m-fail { background: var(--warn); } .m-bad { background: var(--bad); }
code { font-size: 12px; }
</style></head><body><main>
<h1>Agent lab run</h1>
<div class="meta">${esc(m.run)} · brain ${esc(m.brain)} · faults ${esc(m.faults)} · trials ${fmt(m.trials)} · seed ${fmt(m.seed)} · prompt ${esc(m.prompt_version)} · model ${esc(m.model)} · dataset ${esc(m.dataset_sha256)} · git ${esc(String(m.git_sha).slice(0, 10))}${m.label ? ` · ${esc(m.label)}` : ""}</div>
<div class="banner ${unsafe ? "bad" : "ok"}">${unsafe ? "Safety invariants broke in this run: each one is a runtime bug, whatever the model did." : "Every safety invariant held in every trial."}</div>
<div class="tiles">
${tile("pass@1", s.pass_at_1 === null ? null : `${s.pass_at_1}%`, "plain", ci)}
${tile("pass@k", s.pass_at_k === null ? null : `${s.pass_at_k}%`, "plain", "any trial passes")}
${tile("pass^k", s.pass_hat_k === null ? null : `${s.pass_hat_k}%`, "plain", "every trial passes")}
${tile("safety", s.safety_rate === null ? null : `${s.safety_rate}%`, unsafe ? "bad" : "ok", "trials with no violation")}
${tile("flaky cases", s.flaky_cases.length, s.flaky_cases.length ? "bad" : "plain")}
${tile("p95 case latency", s.p95_case_latency_ms === null ? null : `${s.p95_case_latency_ms} ms`)}
${live ? tile("tokens / case", s.avg_tokens_per_case) : tile("tokens / case", "n/a", "plain", "scripted model: no real usage")}
${live ? tile("cost / case", `$${s.cost_per_case_usd}`) : tile("cost / case", "n/a", "plain", "scripted model: no real usage")}
</div>
<p class="muted small">With the scripted brain, pass rates measure plumbing only (it never quotes or orders); answer quality needs <code>--brain live</code>. Safety invariants are meaningful with any brain.</p>
<h2>Safety invariant violations</h2>${table(["invariant", "trials"], violationRows)}
<h2>Faults injected → outcome</h2>${table(["fault", "injected", "trials hit", "unsafe trials"], faultRows)}
${cmp ? `<h2>Against baseline <code>${esc(cmp.baseline)}</code></h2>
${table(["metric", "baseline", "now", "Δ"], Object.entries(cmp.deltas).map(([k, d]) => [esc(k), fmt(d.base), fmt(d.now), d.delta === null ? "—" : `${d.delta > 0 ? "+" : ""}${d.delta}`]))}
<p><b>Regressed</b> (pass^k lost): ${cmp.regressed.map(esc).join(", ") || "none"}<br><b>Fixed</b>: ${cmp.fixed.map(esc).join(", ") || "none"}<br><b>Newly unsafe</b>: <span class="${cmp.newly_unsafe.length ? "bad-text" : ""}">${cmp.newly_unsafe.map(esc).join(", ") || "none"}</span>${cmp.missing.length ? `<br><b>Missing from this run</b>: ${cmp.missing.map(esc).join(", ")}` : ""}</p>` : ""}
<h2>Answer quality (first trial, harness metrics)</h2>${table(["suite", "pass %", "invented price %", "wrong action %", "handoff acc.", "tool recall", "language", "p95 turn ms"], qualityRows)}
<h2>Run history</h2>${table(["run", "label", "brain", "faults", "k", "pass@1", "pass^k", "safety", "violations", "git"], historyRows)}
<h2>Cases</h2><p class="muted small">One square per trial: green pass, amber fail, red safety violation. Hover for the reasons.</p>
${table(["case", "category", "trials", "faults", "why"], caseRows)}
</main></body></html>`;
}
