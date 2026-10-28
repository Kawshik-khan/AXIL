/**
 * Lab console: the experiment registry. Every `experiments/*.cjs` file (not starting with "_") exports one experiment
 * or an array of them. The registry checks each definition, resolves dynamic options, validates submitted params
 * strictly (unknown keys refused, types, ranges, patterns, option lists), and builds the `node` argument list.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "experiments");
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const TYPES = new Set(["select", "number", "bool", "text"]);

function checkDefinition(e, file) {
  const where = `${path.basename(file)}${e && e.id ? ` (${e.id})` : ""}`;
  if (!e || typeof e !== "object") throw new Error(`${where}: not an experiment object`);
  if (!ID.test(e.id || "")) throw new Error(`${where}: id must match ${ID}`);
  for (const k of ["title", "group", "description"]) if (typeof e[k] !== "string" || !e[k]) throw new Error(`${where}: ${k} is required`);
  if (typeof e.command !== "function") throw new Error(`${where}: command(params, ctx) is required`);
  if (!Array.isArray(e.params)) throw new Error(`${where}: params must be an array`);
  for (const p of e.params) {
    if (!/^[A-Za-z][\w]{0,40}$/.test(p.name || "")) throw new Error(`${where}: bad param name ${p.name}`);
    if (!TYPES.has(p.type)) throw new Error(`${where}: param ${p.name} has unknown type ${p.type}`);
    if (p.type === "select" && !(Array.isArray(p.options) || typeof p.options === "function")) throw new Error(`${where}: select ${p.name} needs options`);
    if (p.type === "text" && typeof p.pattern !== "string") throw new Error(`${where}: text ${p.name} needs a pattern`);
    if (p.type === "number" && !(Number.isFinite(p.min) && Number.isFinite(p.max))) throw new Error(`${where}: number ${p.name} needs min and max`);
  }
  for (const r of e.artifactRoots || []) if (!/^lab-out\/[\w./-]+$/.test(r) || r.includes("..")) throw new Error(`${where}: artifact root ${r} must be inside lab-out/`);
  return e;
}

/** Loads every experiment file. A broken file is reported, not fatal: the others still load. */
function loadExperiments(dir = DIR) {
  const experiments = new Map();
  const errors = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".cjs") && !x.startsWith("_")).sort()) {
    const file = path.join(dir, f);
    try {
      delete require.cache[require.resolve(file)];
      const mod = require(file);
      for (const e of Array.isArray(mod) ? mod : [mod]) {
        checkDefinition(e, file);
        if (experiments.has(e.id)) throw new Error(`${f}: duplicate id ${e.id}`);
        experiments.set(e.id, { ...e, file: f });
      }
    } catch (err) {
      errors.push(`${f}: ${err.message}`);
    }
  }
  return { experiments, errors };
}

function optionsOf(p, ctx) {
  const list = typeof p.options === "function" ? p.options(ctx) : p.options;
  return list.map(String);
}

/** The definition as the UI sees it: no functions, options resolved, cost of the defaults. */
function describe(e, ctx) {
  const params = e.params.map((p) => ({ name: p.name, label: p.label || p.name, type: p.type, help: p.help || "", default: p.default ?? (p.type === "bool" ? false : p.type === "number" ? p.min : ""), min: p.min, max: p.max, integer: Boolean(p.integer), pattern: p.pattern, required: Boolean(p.required), options: p.type === "select" ? optionsOf(p, ctx) : undefined }));
  return { id: e.id, title: e.title, group: e.group, description: e.description, file: e.file, params, artifactRoots: e.artifactRoots || [], paidPossible: typeof e.cost === "function" };
}

/** Validates submitted values; returns { values, errors }. Missing params take their default. */
function validate(e, input, ctx) {
  const errors = [];
  const values = {};
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const known = new Set(e.params.map((p) => p.name));
  for (const k of Object.keys(raw)) if (!known.has(k)) errors.push(`unknown param ${k}`);
  for (const p of e.params) {
    const has = Object.prototype.hasOwnProperty.call(raw, p.name);
    let v = has ? raw[p.name] : p.default;
    if (p.type === "bool") {
      if (v === undefined) v = false;
      if (typeof v !== "boolean") errors.push(`${p.name} must be true or false`);
    } else if (p.type === "number") {
      v = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof v !== "number" || !Number.isFinite(v) || v < p.min || v > p.max || (p.integer && !Number.isInteger(v))) errors.push(`${p.name} must be ${p.integer ? "a whole number" : "a number"} from ${p.min} to ${p.max}`);
    } else if (p.type === "text") {
      v = v === undefined || v === null ? "" : v;
      if (typeof v !== "string" || !new RegExp(p.pattern).test(v)) errors.push(`${p.name} doesn't match ${p.pattern}`);
    } else if (p.type === "select") {
      const opts = optionsOf(p, ctx);
      v = v === undefined || v === null ? (p.required ? undefined : opts[0]) : String(v);
      if (v === undefined || !opts.includes(v)) errors.push(`${p.name} must be one of the listed options`);
    }
    values[p.name] = v;
  }
  return { values, errors };
}

/** The process to start: node + args (never a shell), extra env, and whether it costs money. */
function plan(e, values, ctx) {
  const cmd = e.command(values, ctx);
  if (!cmd || !Array.isArray(cmd.args) || !cmd.args.every((a) => typeof a === "string")) throw new Error(`${e.id}: command() must return { args: string[] }`);
  const env = {};
  for (const [k, v] of Object.entries(cmd.env || {})) {
    if (!/^[A-Z][A-Z0-9_]{0,60}$/.test(k) || typeof v !== "string") throw new Error(`${e.id}: bad env entry ${k}`);
    env[k] = v;
  }
  const cost = typeof e.cost === "function" ? e.cost(values) : "free";
  return { args: cmd.args, env, cost: cost === "paid" ? "paid" : "free", warning: typeof e.warning === "function" ? e.warning(values) || "" : "" };
}

module.exports = { loadExperiments, describe, validate, plan, checkDefinition };
