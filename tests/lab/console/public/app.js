/* CommerceOS lab console UI: vanilla JS, no build step. All text goes in via textContent (never innerHTML). */
(() => {
  "use strict";
  const TOKEN = document.querySelector('meta[name="lab-token"]').content;
  const app = document.getElementById("app");
  const live = document.getElementById("live");
  const SVG = "http://www.w3.org/2000/svg";
  let cleanup = [];

  // ---------------------------------------------------------------------------------------------- tiny DOM helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const badge = (text, cls) => h("span", { class: `badge ${cls || text}`, text });
  const fmtMs = (ms) => (ms === null || ms === undefined ? "—" : ms < 1000 ? `${ms} ms` : ms < 120000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`);
  const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 1000) / 10}%`);
  const num = (x) => (x === null || x === undefined ? "—" : String(x));
  const ago = (iso) => {
    if (!iso) return "—";
    const d = (Date.now() - Date.parse(iso)) / 1000;
    return d < 60 ? "just now" : d < 3600 ? `${Math.round(d / 60)} min ago` : d < 86400 ? `${Math.round(d / 3600)} h ago` : `${Math.round(d / 86400)} d ago`;
  };
  const fileUrl = (p) => `/files?path=${encodeURIComponent(p)}`;

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { ...(opts.body ? { "Content-Type": "application/json", "X-Lab-Token": TOKEN } : {}), ...(opts.headers || {}) } });
    const type = res.headers.get("content-type") || "";
    const body = type.includes("json") ? await res.json() : await res.text();
    if (!res.ok) throw Object.assign(new Error((body && (body.error || (body.errors || []).join("; "))) || res.statusText), { status: res.status, body });
    return body;
  }
  const post = (path, data) => api(path, { method: "POST", body: JSON.stringify(data || {}) });

  function page(title, subtitle, ...content) {
    app.replaceChildren(...[h("h1", { text: title }), subtitle ? h("p", { class: "sub", text: subtitle }) : null, ...content].filter(Boolean));
  }
  function card(title, ...content) {
    return h("section", { class: "card" }, title ? h("h2", { text: title }) : null, ...content);
  }
  function table(head, rows, onClick) {
    if (!rows.length) return h("div", { class: "empty", text: "Nothing yet." });
    return h("div", { class: "scroll" }, h("table", null,
      h("thead", null, h("tr", null, head.map((x) => h("th", { text: x })))),
      h("tbody", null, rows.map((r, i) => h("tr", { class: onClick ? "click" : null, onclick: onClick ? () => onClick(i) : null }, r.map((c) => h("td", null, c)))))));
  }
  function kpi(label, value, hint, tone) {
    return h("div", { class: `card kpi ${tone || ""}` }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }), hint ? h("div", { class: "hint", text: hint }) : null);
  }

  // ---------------------------------------------------------------------------------------------- charts (inline SVG)
  function lineChart(series, labels, { max = 100, height = 180, unit = "%" } = {}) {
    const W = 640, H = height, L = 34, R = 8, T = 8, B = 22;
    const n = labels.length;
    const x = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": series.map((x) => x.name).join(", ") });
    for (const v of [0, max / 2, max]) svg.append(s("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }), s("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end" }, `${v}${unit}`));
    series.forEach((ser) => {
      const pts = ser.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(Math.min(max, v))]));
      const d = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), "");
      svg.append(s("path", { d, class: `${ser.cls} line`, "stroke-width": 2 }));
      pts.forEach((p, i) => p && svg.append(s("circle", { cx: p[0], cy: p[1], r: 3, class: ser.cls }, s("title", null, `${labels[i]} · ${ser.name}: ${ser.values[i]}${unit}`))));
    });
    const step = Math.max(1, Math.ceil(n / 8));
    labels.forEach((l, i) => i % step === 0 && svg.append(s("text", { x: x(i), y: H - 6, "text-anchor": "middle" }, l)));
    return h("div", null, svg, h("div", { class: "legend" }, series.map((x) => h("span", null, h("i", { class: x.cls }), x.name))));
  }
  function stackedBars(days) {
    const W = 640, H = 150, L = 24, B = 22, T = 8;
    const max = Math.max(1, ...days.map((d) => d.passed + d.failed));
    const bw = (W - L) / days.length;
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Runs per day" });
    svg.append(s("line", { class: "grid", x1: L, x2: W, y1: H - B, y2: H - B }), s("text", { x: L - 4, y: T + 8, "text-anchor": "end" }, String(max)));
    days.forEach((d, i) => {
      const scale = (H - B - T) / max;
      const x = L + i * bw + bw * 0.18;
      const okH = d.passed * scale, badH = d.failed * scale;
      if (d.passed) svg.append(s("rect", { x, y: H - B - okH, width: bw * 0.64, height: okH, rx: 2, class: "cok" }, s("title", null, `${d.date}: ${d.passed} passed`)));
      if (d.failed) svg.append(s("rect", { x, y: H - B - okH - badH, width: bw * 0.64, height: badH, rx: 2, class: "cbad" }, s("title", null, `${d.date}: ${d.failed} failed`)));
      if (i % 2 === 0) svg.append(s("text", { x: x + bw * 0.32, y: H - 6, "text-anchor": "middle" }, d.date.slice(5)));
    });
    return h("div", null, svg, h("div", { class: "legend" }, h("span", null, h("i", { class: "cok" }), "passed"), h("span", null, h("i", { class: "cbad" }), "failed / cancelled")));
  }
  function hBars(items, { valueLabel }) {
    const W = 640, row = 20, L = 210;
    const max = Math.max(1, ...items.map((x) => x.value));
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${items.length * row + 4}`, role: "img", "aria-label": "Suite durations" });
    items.forEach((it, i) => {
      const w = ((W - L - 70) * it.value) / max;
      svg.append(
        s("text", { x: L - 8, y: i * row + 14, "text-anchor": "end" }, it.label.length > 32 ? `${it.label.slice(0, 31)}…` : it.label),
        s("rect", { x: L, y: i * row + 4, width: Math.max(2, w), height: row - 7, rx: 3, class: it.cls }, s("title", null, `${it.label}: ${valueLabel(it.value)}`)),
        s("text", { x: L + w + 6, y: i * row + 14 }, valueLabel(it.value)),
      );
    });
    return svg;
  }

  // ---------------------------------------------------------------------------------------------- dashboard
  let redrawDashStatus = () => undefined;
  async function dashboard({ quiet = false } = {}) {
    const seq = routeSeq;
    const d = await api("/api/dashboard");
    if (seq !== routeSeq) return; // the user moved to another page while this loaded
    const scrollY = window.scrollY;
    const agentRuns = d.agent.runs;
    const lastAgent = agentRuns[agentRuns.length - 1];
    const full = d.tests.latest;
    const count = (st) => (full ? full.suites.filter((x) => x.status === st).length : 0);
    const lastImage = d.image.runs[d.image.runs.length - 1];
    const bestCombo = lastImage ? [...lastImage.combos].sort((a, b) => (b.precision_lower_95 ?? -1) - (a.precision_lower_95 ?? -1))[0] : null;
    const recall = d.rag.retrieval ? Object.values(d.rag.retrieval.recall_at_2_by_language || {}) : [];

    const kpis = h("div", { class: "grid kpis" },
      kpi("Console runs", num(d.runs.total), `${d.runs.passed} passed · ${d.runs.failed} failed${d.runs.running ? ` · ${d.runs.running} active` : ""}`),
      kpi("Agent pass^k", lastAgent ? `${num(lastAgent.pass_hat_k)}%` : "—", lastAgent ? `${lastAgent.brain} · ${lastAgent.faults} · k=${lastAgent.trials}` : "no agent run yet"),
      kpi("Agent safety", lastAgent ? `${num(lastAgent.safety_rate)}%` : "—", lastAgent ? `${lastAgent.violations} violations` : "", lastAgent ? (lastAgent.violations ? "bad" : "good") : ""),
      kpi("Test suites", full ? `${count("PASS")}/${full.suites.length}` : "—", full ? `${count("FAIL")} fail · ${count("FLAKY")} flaky · ${fmtMs(full.wall_ms)}` : "no suite run yet", full ? (count("FAIL") ? "bad" : "good") : ""),
      kpi("Image precision@HIGH", bestCombo ? pct(bestCombo.precision) : "—", bestCombo ? `95% low ${pct(bestCombo.precision_lower_95)}${lastImage.mock ? " · mock" : ""}` : "no bake-off yet"),
      kpi("Retrieval Recall@2", recall.length ? `${Math.min(...recall)}%` : "—", d.rag.retrieval ? `worst language · ${d.rag.retrieval.embeddings}` : "not run"),
    );

    const agentCard = card("Agent model harness · trend",
      agentRuns.length
        ? lineChart([
          { name: "pass^k", cls: "c1", values: agentRuns.map((r) => r.pass_hat_k) },
          { name: "pass@1", cls: "c4", values: agentRuns.map((r) => r.pass_at_1) },
          { name: "safety", cls: "c2", values: agentRuns.map((r) => r.safety_rate) },
        ], agentRuns.map((r) => r.run.slice(5, 16).replace("T", " ")))
        : h("div", { class: "empty", text: "Run the agent model harness to see the trend." }),
      agentRuns.length ? h("p", { class: "small muted", text: "Scripted-model pass rates measure plumbing only; safety is meaningful with any model." }) : null,
    );
    const runsCard = card("Console runs · last 14 days", stackedBars(d.runs.days));

    const suites = d.tests.latest ? [...d.tests.latest.suites].sort((a, b) => b.ms - a.ms).slice(0, 18) : [];
    const testsCard = card(`Test suites · slowest${d.tests.latest ? ` (${d.tests.latest.run.slice(0, 16)})` : ""}`,
      suites.length ? hBars(suites.map((x) => ({ label: x.suite, value: x.ms, cls: x.status === "FAIL" ? "cbad" : x.status === "FLAKY" ? "cwarn" : "c1" })), { valueLabel: fmtMs }) : h("div", { class: "empty", text: "Run the parallel test suites to see durations." }),
      d.tests.latest ? table(["suite", "status", "first failure"], d.tests.latest.suites.filter((x) => x.status !== "PASS").map((x) => [h("a", { href: fileUrl(x.log), target: "_blank", rel: "noopener", text: x.suite }), badge(x.status), h("span", { class: "small", text: (x.first_failure || "").replace(/\x1b?\[[0-9;]*m/g, "") })])) : null,
    );
    const testHistory = card("Test suites · history",
      d.tests.history.length ? lineChart([
        { name: "wall time (s)", cls: "c1", values: d.tests.history.map((r) => Math.round(r.wall_ms / 1000)) },
        { name: "failing suites", cls: "c3", values: d.tests.history.map((r) => r.fail) },
      ], d.tests.history.map((r) => r.run.slice(5, 16).replace("T", " ")), { max: Math.max(10, ...d.tests.history.map((r) => Math.round(r.wall_ms / 1000))), unit: "" }) : h("div", { class: "empty", text: "No suite runs yet." }),
    );

    const imageCard = card("Image search bake-off · latest",
      lastImage ? h("div", null,
        h("p", { class: "small muted" }, `${lastImage.run}${lastImage.mock ? " · mock providers (not a model measurement)" : ""} · `, h("a", { href: fileUrl(lastImage.report), target: "_blank", rel: "noopener", text: "report" })),
        lastImage.warnings.map((w) => h("div", { class: "warnbox small", text: w })),
        table(["vision × embedding", "precision@HIGH", "95% low", "coverage", "HIGH", "p95", ""], lastImage.combos.map((c) => [`${c.vision} × ${c.embedding}`, pct(c.precision), pct(c.precision_lower_95), pct(c.coverage), num(c.high_count), fmtMs(c.p95_ms), c.meets_target ? badge("meets target", "passed") : badge("below", "failed")])),
      ) : h("div", { class: "empty", text: "Run the image bake-off (init-sample, then mock) to see results." }),
    );
    const r = d.rag;
    const ragCard = card("Knowledge retrieval & RAG",
      r.retrieval ? h("div", null, h("h3", { text: `Policy search · ${r.retrieval.queries} queries · ${r.retrieval.embeddings}` }),
        table(["language", "Recall@2"], Object.entries(r.retrieval.recall_at_2_by_language || {}).map(([k, v]) => [k, `${v}%`])),
        h("p", { class: "small muted", text: `Irrelevant document ranked first: ${r.retrieval.irrelevant_ranked_first} of ${r.retrieval.queries}` })) : null,
      r.replay ? h("div", null, h("h3", { text: `RAG replay · ${r.replay.dataset} · ${r.replay.mode}` }),
        table(["metric", "value"], Object.entries(r.replay.metrics).map(([k, v]) => [k, typeof v === "number" && v <= 1 && !/count|cases/.test(k) ? pct(v) : num(v)])),
        h("p", { class: "small muted" }, `${r.replay.review_status || ""} · `, r.replay.file.startsWith("lab-out") ? h("a", { href: fileUrl(r.replay.file), target: "_blank", rel: "noopener", text: "report" }) : r.replay.file)) : null,
      !r.retrieval && !r.replay ? h("div", { class: "empty", text: "Run the retrieval eval or RAG replay." }) : null,
    );

    const latest = Object.entries(d.runs.latestByExperiment);
    const recent = card("Latest result per experiment",
      table(["experiment", "status", "when", "summary"], latest.map(([exp, x]) => [exp, badge(x.status), ago(x.created_at), h("span", { class: "small mono", text: x.summary || "" })]), (i) => (location.hash = `#/runs/${latest[i][1].id}`)));

    const status = h("div", { class: "row small muted", id: "dash-status" });
    const drawStatus = () => {
      const n = activeRuns.size;
      status.replaceChildren(h("span", { class: `dot ${connected ? (n ? "on" : "idle") : "off"}` }),
        connected ? (n ? `Live · ${n} run${n === 1 ? "" : "s"} active: ${[...activeRuns.values()].map((r) => r.experiment).join(", ")} · refreshing as they progress` : "Live · updates when a run starts or finishes") : "Reconnecting… (showing the last loaded data)",
        h("span", { class: "spacer" }), `Updated ${new Date(d.generated_at).toLocaleTimeString()}`);
    };
    drawStatus();
    redrawDashStatus = drawStatus;
    page("Dashboard", "Results from every harness in one place: agent model harness, test suites, image bake-off, retrieval and RAG.",
      status, kpis, h("div", { class: "grid two" }, agentCard, runsCard, testsCard, testHistory, imageCard, ragCard), h("div", { class: "gap" }), recent);
    if (quiet) window.scrollTo(0, scrollY);
    if (quiet) return;
    // Live: refresh when a run is queued, starts or ends (debounced), and every 10 s while runs are active
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => dashboard({ quiet: true }).catch(() => undefined), 600);
    };
    const tick = setInterval(() => activeRuns.size && refresh(), 10000);
    // Connection lost: say so at once (the data can't be fetched); back: reload everything, it may have changed
    const off = onRunEvent((event) => (event === "connection" ? (connected ? refresh() : redrawDashStatus()) : refresh()));
    cleanup.push(() => { clearTimeout(timer); clearInterval(tick); off(); });
  }

  // ---------------------------------------------------------------------------------------------- experiments
  let catalog = null;
  async function loadCatalog(force) {
    if (!catalog || force) catalog = await api("/api/experiments");
    return catalog;
  }
  async function experiments() {
    const { experiments: list, errors } = await loadCatalog(true);
    const groups = {};
    for (const e of list) (groups[e.group] ||= []).push(e);
    const reload = h("button", { class: "btn", text: "Reload experiment files", onclick: async () => { await post("/api/experiments/reload"); experiments(); } });
    page("Experiments", "Pick a harness, set its parameters, run it. Add your own: copy tests/lab/console/experiments/_template.cjs.",
      h("div", { class: "row" }, h("span", { class: "spacer" }), reload),
      errors.length ? h("div", { class: "errbox", text: `Not loaded: ${errors.join(" · ")}` }) : null,
      h("div", { class: "groups" }, Object.entries(groups).map(([g, items]) => h("section", null, h("h3", { text: g }),
        h("div", { class: "cards" }, items.map((e) => h("a", { class: "card exp", href: `#/experiments/${e.id}` },
          h("div", { class: "row" }, h("span", { class: "t", text: e.title }), h("span", { class: "spacer" }), e.paidPossible ? badge("free / paid", "queued") : badge("free")),
          h("div", { class: "d", text: e.description }),
          h("div", { class: "small muted mono", text: e.file }))))))));
  }

  async function experiment(id) {
    const { experiments: list } = await loadCatalog(true);
    const e = list.find((x) => x.id === id);
    if (!e) return page("Experiment not found", "");
    const inputs = {};
    const fields = e.params.map((p) => {
      const idAttr = `p_${p.name}`;
      let input;
      if (p.type === "bool") input = h("input", { type: "checkbox", id: idAttr, checked: p.default ? true : null });
      else if (p.type === "select") {
        input = h("select", { id: idAttr }, p.options.map((o) => h("option", { value: o, text: o === "" ? "(none)" : o })));
        if (p.options.includes(String(p.default))) input.value = String(p.default);
      } else input = h("input", { type: p.type === "number" ? "number" : "text", id: idAttr, value: String(p.default ?? ""), min: p.min, max: p.max, step: p.type === "number" ? (p.integer ? 1 : "any") : null });
      inputs[p.name] = { p, input };
      return h("div", { class: `field${p.type === "bool" ? " check" : ""}` }, p.type === "bool" ? input : null, h("label", { for: idAttr, text: p.label }), p.type !== "bool" ? input : null, p.help ? h("div", { class: "help", text: p.help }) : null);
    });
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, { p, input }]) => [k, p.type === "bool" ? input.checked : p.type === "number" ? Number(input.value) : input.value]));
    const cmd = h("div", { class: "cmd mono" });
    const costBadge = h("span");
    const warn = h("div");
    const err = h("div");
    const runBtn = h("button", { class: "btn primary", text: "Run experiment" });
    let lastPreview = null;
    async function preview() {
      try {
        lastPreview = await post("/api/preview", { experiment: e.id, params: values() });
        cmd.textContent = `${lastPreview.command}${lastPreview.env.length ? `   [env: ${lastPreview.env.join(", ")}]` : ""}`;
        costBadge.replaceChildren(badge(lastPreview.cost));
        warn.replaceChildren(lastPreview.warning ? h("div", { class: "warnbox", text: lastPreview.warning }) : "");
        err.replaceChildren();
        runBtn.disabled = false;
      } catch (x) {
        lastPreview = null;
        err.replaceChildren(h("div", { class: "errbox", text: x.message }));
        runBtn.disabled = true;
      }
    }
    for (const { input } of Object.values(inputs)) for (const ev of ["input", "change"]) input.addEventListener(ev, preview);
    runBtn.addEventListener("click", async () => {
      if (!lastPreview) return;
      let confirm_cost = false;
      if (lastPreview.cost === "paid") {
        if (!window.confirm(`This run costs money or sends data to an outside provider.\n\n${lastPreview.warning}\n\nRun it?`)) return;
        confirm_cost = true;
      }
      runBtn.disabled = true;
      try {
        const { run } = await post("/api/runs", { experiment: e.id, params: values(), confirm_cost });
        location.hash = `#/runs/${run.id}`;
      } catch (x) {
        err.replaceChildren(h("div", { class: "errbox", text: x.message }));
        runBtn.disabled = false;
      }
    });
    const { runs } = await api("/api/runs");
    const mine = runs.filter((r) => r.experiment === e.id).slice(0, 15);
    page(e.title, e.description,
      card("Parameters", e.params.length ? h("div", { class: "form" }, fields) : h("p", { class: "muted", text: "No parameters." }),
        h("div", { class: "gap" }), h("h3", { text: "Command" }), cmd, h("div", { class: "gap" }), warn, err,
        h("div", { class: "gap" }), h("div", { class: "row" }, runBtn, costBadge, h("span", { class: "small muted", text: `defined in experiments/${e.file}` }))),
      h("div", { class: "gap" }),
      card("Recent runs", runTable(mine)));
    preview();
  }

  // ---------------------------------------------------------------------------------------------- runs
  function runTable(runs) {
    return table(["run", "experiment", "status", "cost", "started", "duration", "summary"], runs.map((r) => [
      h("span", { class: "mono small", text: r.id.slice(0, 19) }), r.title, badge(r.status), badge(r.cost), ago(r.created_at), fmtMs(r.duration_ms), h("span", { class: "small mono", text: (r.summary || "").slice(0, 120) }),
    ]), (i) => (location.hash = `#/runs/${runs[i].id}`));
  }
  async function runsPage(keep) {
    const seq = routeSeq;
    const { runs } = await api("/api/runs");
    if (seq !== routeSeq) return;
    const exps = [...new Set(runs.map((r) => r.experiment))].sort();
    const status = h("select", null, ["all", "passed", "failed", "running", "queued", "cancelled", "interrupted"].map((x) => h("option", { value: x, text: x })));
    const exp = h("select", null, ["all", ...exps].map((x) => h("option", { value: x, text: x })));
    const holder = h("div");
    const draw = () => holder.replaceChildren(runTable(runs.filter((r) => (status.value === "all" || r.status === status.value) && (exp.value === "all" || r.experiment === exp.value))));
    if (keep) {
      status.value = keep.status;
      if ([...exp.options].some((o) => o.value === keep.exp)) exp.value = keep.exp;
    }
    status.addEventListener("change", draw);
    exp.addEventListener("change", draw);
    draw();
    page("Runs", "Every run started from the console, newest first. Logs and records live in lab-out/console/runs/.",
      card(null, h("div", { class: "row" }, h("label", { class: "small", text: "Status" }), status, h("label", { class: "small", text: "Experiment" }), exp), h("div", { class: "gap" }), holder));
    if (keep) return;
    // Live: re-list when any run changes, keeping the chosen filters
    let timer = null;
    const off = onRunEvent((event) => {
      if (event === "connection") return;
      clearTimeout(timer);
      timer = setTimeout(() => runsPage({ status: status.value, exp: exp.value }).catch(() => undefined), 300);
    });
    cleanup.push(() => { clearTimeout(timer); off(); });
  }

  async function runPage(id) {
    let { run } = await api(`/api/runs/${encodeURIComponent(id)}`);
    const status = h("span");
    const meta = h("dl", { class: "kv" });
    const logEl = h("pre", { class: "log mono" });
    const artifacts = h("div");
    const cancel = h("button", { class: "btn danger", text: "Cancel run", onclick: async () => { cancel.disabled = true; await post(`/api/runs/${encodeURIComponent(id)}/cancel`); } });
    const again = h("button", { class: "btn", text: "Run again with these parameters", onclick: () => { location.hash = `#/experiments/${run.experiment}`; } });
    const drawMeta = () => {
      status.replaceChildren(badge(run.status));
      cancel.hidden = !["running", "queued"].includes(run.status);
      const rows = [["experiment", run.title], ["started", run.started_at || "—"], ["duration", fmtMs(run.duration_ms)], ["exit code", num(run.exit_code)], ["cost", run.cost], ["command", run.command], ["parameters", JSON.stringify(run.params)], ["summary", run.summary || "—"]];
      meta.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { class: k === "command" || k === "parameters" ? "mono" : null, text: v })]));
      const html = (run.artifacts || []).filter((a) => a.endsWith(".html"));
      artifacts.replaceChildren(...[
        (run.artifacts || []).length ? h("ul", null, run.artifacts.map((a) => h("li", null, h("a", { href: fileUrl(a), target: "_blank", rel: "noopener", text: a })))) : h("p", { class: "muted small", text: ["running", "queued"].includes(run.status) ? "Reports appear here when the run ends." : "This run wrote no report files." }),
        html.length ? h("p", null, h("a", { class: "btn primary", href: fileUrl(html[0]), target: "_blank", rel: "noopener", text: "Open report" })) : null,
      ].filter(Boolean));
    };
    page(`Run · ${run.title}`, run.id,
      h("div", { class: "row" }, status, cancel, again),
      h("div", { class: "gap" }),
      h("div", { class: "grid two" }, card("Details", meta), card("Reports", artifacts)),
      h("div", { class: "gap" }),
      card("Output", logEl));
    drawMeta();
    const es = new EventSource(`/api/runs/${encodeURIComponent(id)}/stream`);
    let stick = true;
    logEl.addEventListener("scroll", () => { stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30; });
    es.addEventListener("log", (ev) => {
      logEl.textContent += JSON.parse(ev.data).replace(/\x1b\[[0-9;]*m/g, "");
      if (stick) logEl.scrollTop = logEl.scrollHeight;
    });
    es.addEventListener("status", (ev) => { run = JSON.parse(ev.data); drawMeta(); });
    es.addEventListener("end", (ev) => { run = JSON.parse(ev.data); drawMeta(); es.close(); refreshLive(); });
    es.onerror = () => es.close();
    cleanup.push(() => es.close());
  }

  // ---------------------------------------------------------------------------------------------- live run events
  // One EventSource for the whole app (/api/events): "hello" lists active runs, then "status" and "end" per change.
  // The browser reconnects by itself; on reconnect the "hello" resets the active list, so nothing drifts.
  const activeRuns = new Map();
  const runHandlers = new Set();
  let connected = false;
  function onRunEvent(fn) {
    runHandlers.add(fn);
    return () => runHandlers.delete(fn);
  }
  function drawHeader() {
    const n = activeRuns.size;
    live.textContent = !connected ? "console offline · reconnecting" : n ? `● ${n} running: ${[...activeRuns.values()].map((r) => r.experiment).join(", ")}` : "idle";
  }
  function refreshLive() {
    drawHeader();
  }
  function connectEvents() {
    const es = new EventSource("/api/events");
    es.addEventListener("hello", (ev) => {
      activeRuns.clear();
      for (const r of JSON.parse(ev.data).active) activeRuns.set(r.id, r);
      connected = true;
      drawHeader();
      for (const fn of runHandlers) fn("connection");
    });
    for (const name of ["status", "end"]) {
      es.addEventListener(name, (ev) => {
        const r = JSON.parse(ev.data);
        if (name === "status" && ["queued", "running"].includes(r.status)) activeRuns.set(r.id, r);
        else activeRuns.delete(r.id);
        drawHeader();
        for (const fn of runHandlers) fn(name, r);
      });
    }
    es.onerror = () => {
      if (!connected) return;
      connected = false;
      drawHeader();
      for (const fn of runHandlers) fn("connection");
    };
  }

  // ---------------------------------------------------------------------------------------------- router
  let routeSeq = 0;
  async function route() {
    routeSeq++;
    for (const fn of cleanup) fn();
    cleanup = [];
    const parts = (location.hash || "#/dashboard").slice(2).split("/");
    for (const a of document.querySelectorAll(".tabs a")) a.classList.toggle("on", a.dataset.tab === parts[0]);
    try {
      if (parts[0] === "experiments" && parts[1]) await experiment(decodeURIComponent(parts[1]));
      else if (parts[0] === "experiments") await experiments();
      else if (parts[0] === "runs" && parts[1]) await runPage(decodeURIComponent(parts[1]));
      else if (parts[0] === "runs") await runsPage();
      else await dashboard();
    } catch (x) {
      page("Something went wrong", "", h("div", { class: "errbox", text: x.message }));
    }
    app.focus({ preventScroll: true });
  }
  window.addEventListener("hashchange", route);
  connectEvents();
  route();
})();
