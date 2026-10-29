/**
 * Lab console: a local web UI for the lab (docs/agent-lab.md). Pick an experiment (test suites, agent model harness,
 * image bake-off, evals, RAG, any single suite, or your own in experiments/), fill its form, run it, watch the log
 * live, open its reports; the dashboard charts results across runs.
 *
 *   npm run lab:console                 http://127.0.0.1:4317
 *   LAB_CONSOLE_PORT=5000 LAB_CONSOLE_JOBS=1 npm run lab:console
 *
 * It starts processes on this machine, so it is locked down: it listens on 127.0.0.1 only, refuses any Host header
 * but its own (DNS rebinding), needs the per-start token embedded in its page for every write (other sites can't read
 * the page, so they can't post), runs only registered experiments with validated params (never a shell or a free
 * command), asks before anything that costs money, and serves files only from lab-out/ and eval-out/ (never
 * eval-data/, which holds customer photos), with report pages sandboxed.
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { loadExperiments, describe, validate, plan } = require("./registry.cjs");
const { RunManager } = require("./runner.cjs");
const { dashboard } = require("./dashboard-data.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PUBLIC = path.join(__dirname, "public");
const FILE_ROOTS = ["lab-out", "eval-out"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jsonl": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".xml": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const REPORT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", ...headers });
  res.end(data);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** A repo-relative path inside lab-out/ or eval-out/, resolved with no way out of those folders. */
function safeFile(root, relPath) {
  if (typeof relPath !== "string" || !relPath || relPath.includes("\0")) return null;
  const norm = relPath.replace(/\\/g, "/");
  const top = norm.split("/")[0];
  if (!FILE_ROOTS.includes(top)) return null;
  const base = path.join(root, top);
  const abs = path.resolve(root, norm);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  if (!TYPES[path.extname(abs)]) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
    // A symlink inside lab-out must not lead out of it
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(base) + path.sep)) return null;
  } catch {
    return null;
  }
  return abs;
}

function createConsole({ root = ROOT, port = 4317, jobs = 2, token = crypto.randomBytes(24).toString("hex") } = {}) {
  const runs = new RunManager({ root, jobs });
  const ctx = { root };
  let registry = loadExperiments();
  const allowedHosts = () => new Set([`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`]);

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!allowedHosts().has(req.headers.host || "")) return send(res, 421, "wrong host");
    const p = url.pathname;

    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8").replace("__LAB_TOKEN__", token);
      return send(res, 200, html, { "Content-Type": TYPES[".html"], "Content-Security-Policy": PAGE_CSP });
    }
    if (req.method === "GET" && (p === "/app.js" || p === "/app.css")) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, p.slice(1))), { "Content-Type": TYPES[path.extname(p)] });
    }

    if (p.startsWith("/api/") && req.method !== "GET") {
      // Every write: the token from the page, as JSON (a cross-site form can't set either)
      const given = String(req.headers["x-lab-token"] || "");
      if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return send(res, 403, { error: "missing or wrong lab token" });
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "JSON only" });
    }

    if (req.method === "GET" && p === "/api/experiments") {
      return send(res, 200, { experiments: [...registry.experiments.values()].map((e) => describe(e, ctx)), errors: registry.errors });
    }
    if (req.method === "POST" && p === "/api/experiments/reload") {
      registry = loadExperiments();
      return send(res, 200, { count: registry.experiments.size, errors: registry.errors });
    }
    if (req.method === "POST" && p === "/api/preview") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const e = registry.experiments.get(body.experiment);
      if (!e) return send(res, 404, { error: "unknown experiment" });
      const { values, errors } = validate(e, body.params, ctx);
      if (errors.length) return send(res, 400, { errors });
      const planned = plan(e, values, { ...ctx, runId: "<run-id>" });
      return send(res, 200, { command: ["node", ...planned.args].join(" "), env: Object.keys(planned.env), cost: planned.cost, warning: planned.warning });
    }
    if (req.method === "GET" && p === "/api/runs") return send(res, 200, { runs: runs.list().slice(0, 300) });
    if (req.method === "POST" && p === "/api/runs") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const e = registry.experiments.get(body.experiment);
      if (!e) return send(res, 404, { error: "unknown experiment" });
      const { values, errors } = validate(e, body.params, ctx);
      if (errors.length) return send(res, 400, { errors });
      const id = runs.newId(e.id);
      const planned = plan(e, values, { ...ctx, runId: id });
      if (planned.cost === "paid" && body.confirm_cost !== true) return send(res, 409, { error: "this run costs money or sends data out: confirm it first", cost: planned.cost, warning: planned.warning });
      return send(res, 201, { run: runs.submit(id, e, values, planned) });
    }
    const m = p.match(/^\/api\/runs\/([\w.-]+)(\/log|\/stream|\/cancel)?$/);
    if (m) {
      const run = runs.get(m[1]);
      if (!run) return send(res, 404, { error: "unknown run" });
      if (req.method === "GET" && !m[2]) return send(res, 200, { run });
      if (req.method === "GET" && m[2] === "/log") return send(res, 200, runs.log(run.id));
      if (req.method === "POST" && m[2] === "/cancel") return send(res, 200, { cancelled: runs.cancel(run.id) });
      if (req.method === "GET" && m[2] === "/stream") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" });
        const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        write("status", run);
        write("log", runs.log(run.id));
        if (!["queued", "running"].includes(run.status)) {
          write("end", run);
          return res.end();
        }
        const ping = setInterval(() => res.write(": ping\n\n"), 15000);
        const off = runs.subscribe(run.id, (event, data) => {
          write(event, data);
          if (event === "end") {
            clearInterval(ping);
            off();
            res.end();
          }
        });
        req.on("close", () => {
          clearInterval(ping);
          off();
        });
        return;
      }
    }
    if (req.method === "GET" && p === "/api/events") {
      // Live run changes for the dashboard and the runs list: one "status" per change, "end" when a run finishes
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" });
      const brief = (r) => ({ id: r.id, experiment: r.experiment, title: r.title, status: r.status, summary: r.summary, duration_ms: r.duration_ms });
      const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      write("hello", { active: runs.list().filter((r) => ["queued", "running"].includes(r.status)).map(brief) });
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      const off = runs.watch((event, run) => write(event, brief(run)));
      req.on("close", () => {
        clearInterval(ping);
        off();
      });
      return;
    }
    if (req.method === "GET" && p === "/api/dashboard") return send(res, 200, dashboard(root, runs.list()));
    if (req.method === "GET" && p === "/files") {
      const abs = safeFile(root, url.searchParams.get("path"));
      if (!abs) return send(res, 404, "not found");
      const ext = path.extname(abs);
      return send(res, 200, fs.readFileSync(abs), { "Content-Type": TYPES[ext], ...(ext === ".html" ? { "Content-Security-Policy": REPORT_CSP } : {}) });
    }
    return send(res, 404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) send(res, err instanceof SyntaxError ? 400 : 500, { error: err instanceof SyntaxError ? "invalid JSON" : err.message });
      else res.end();
    });
  });
  return {
    server, runs, token,
    listen: () => new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      runs.stopAll();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

if (require.main === module) {
  const port = Number(process.env.LAB_CONSOLE_PORT) || 4317;
  const jobs = Math.max(1, Math.min(4, Number(process.env.LAB_CONSOLE_JOBS) || 2));
  const lab = createConsole({ port, jobs });
  lab.listen().then((p) => {
    const reg = loadExperiments();
    process.stdout.write(`CommerceOS lab console: http://127.0.0.1:${p}  (${reg.experiments.size} experiments, ${jobs} at a time)\n`);
    for (const err of reg.errors) process.stdout.write(`  experiment not loaded: ${err}\n`);
  });
  const stop = () => lab.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = { createConsole, safeFile };
