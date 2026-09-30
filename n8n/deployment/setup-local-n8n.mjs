/**
 * Sets up a local Docker n8n for CommerceOS (FX-55, ADR-110): the environment the workflows need, the "CommerceOS API"
 * credential, every workflow in n8n/workflows, and publishes the ones CommerceOS calls. Idempotent; run it again after
 * changing a workflow or n8n/.env.
 *
 *   node n8n/deployment/setup-local-n8n.mjs [--container n8n] [--volume n8n_data] [--image <image>]
 *
 * What it does:
 *   1. n8n/.env (git-ignored): creates COMMERCEOS_N8N_WEBHOOK_SECRET if missing. Optional in the same file:
 *      COMMERCEOS_SERVICE_TOKEN (a cos_svc_ token from CommerceOS Settings → Service Tokens; without it the credential
 *      holds a placeholder and callbacks to CommerceOS get 401), COMMERCEOS_OPERATOR_ALERT_PHONE, COMMERCEOS_API_BASE_URL.
 *   2. Stops the running container and keeps it, renamed, for rollback. The data volume is reused, so the owner
 *      account, API keys and executions stay.
 *   3. With a one-off container on the same volume: imports the credential and the workflows, publishes the ones
 *      CommerceOS calls.
 *   4. Starts n8n again with: the env file, COMMERCEOS_API_BASE_URL, N8N_BLOCK_ENV_ACCESS_IN_NODE=false (the Code
 *      nodes read the secret) and NODE_FUNCTION_ALLOW_BUILTIN=crypto (they compute the HMAC).
 * Never prints a secret. The same COMMERCEOS_N8N_WEBHOOK_SECRET and N8N_HOST=http://localhost:5678 go into CommerceOS's
 * .env.local (copy them yourself; the script doesn't touch CommerceOS's environment).
 */
import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const n8nDir = path.resolve(here, "..");
const envFile = path.join(n8nDir, ".env");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const container = arg("container", "n8n");
const volume = arg("volume", "n8n_data");
/** Workflows CommerceOS calls (published = their webhooks are live). The others are imported, not published. */
const PUBLISH = ["wf_sig_check", "wf_ord_01", "wf_inv_01", "wf_mkt_01"];
const out = (line) => process.stdout.write(`${line}\n`);

function docker(args, { allowFail = false } = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.status !== 0 && !allowFail) {
    const msg = `${r.stderr || r.stdout}`.split("\n").filter(Boolean).slice(-3).join(" | ");
    throw new Error(`docker ${args[0]} failed: ${msg}`);
  }
  return { ok: r.status === 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

// 1. Environment file
const env = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}
if (!env.COMMERCEOS_N8N_WEBHOOK_SECRET) {
  env.COMMERCEOS_N8N_WEBHOOK_SECRET = crypto.randomBytes(32).toString("base64url");
  out("created COMMERCEOS_N8N_WEBHOOK_SECRET in n8n/.env");
}
env.COMMERCEOS_API_BASE_URL ||= "http://host.docker.internal:3000";
fs.writeFileSync(
  envFile,
  [
    "# Local n8n for CommerceOS (git-ignored). Written by n8n/deployment/setup-local-n8n.mjs.",
    "# The same COMMERCEOS_N8N_WEBHOOK_SECRET goes into CommerceOS's .env.local (with N8N_HOST=http://localhost:5678).",
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    "",
  ].join("\n"),
  { mode: 0o600 }
);

// 2. Image and the running container
const current = docker(["inspect", container, "--format", "{{.Image}}"], { allowFail: true });
// After an interrupted run the container is gone: reuse the image of the copy kept for rollback
const kept = docker(["ps", "-a", "--filter", `name=^${container}-before-commerceos-`, "--format", "{{.Image}}"], { allowFail: true }).stdout.split("\n")[0];
const image = arg("image", current.ok ? current.stdout : kept || "n8nio/n8n:latest");
if (current.ok) {
  docker(["stop", container]);
  if (kept) {
    // A copy from before the first run is already kept for rollback; this one was created by this script
    docker(["rm", container]);
    out("stopped and replaced the n8n container (the pre-CommerceOS copy is still kept)");
  } else {
    const keep = `${container}-before-commerceos-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
    docker(["rename", container, keep]);
    out(`stopped the running n8n and kept it as "${keep}" (remove it once you're happy)`);
  }
}

// 3. Import with a one-off container on the same volume (n8n is stopped, so the database is not in use)
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "commerceos-n8n-"));
try {
  const token = env.COMMERCEOS_SERVICE_TOKEN;
  fs.writeFileSync(
    path.join(staging, "credentials.json"),
    JSON.stringify([
      {
        id: "commerceos-api-credential",
        name: "CommerceOS API",
        type: "httpHeaderAuth",
        data: { name: "Authorization", value: `Bearer ${token || "SET_A_COMMERCEOS_SERVICE_TOKEN"}` },
      },
    ]),
    { mode: 0o600 }
  );
  // Several workflows share tag names; n8n refuses the second copy of a tag on import, so tags are left out
  fs.mkdirSync(path.join(staging, "workflows"));
  for (const f of fs.readdirSync(path.join(n8nDir, "workflows")).filter((x) => x.endsWith(".json"))) {
    const w = JSON.parse(fs.readFileSync(path.join(n8nDir, "workflows", f), "utf8"));
    delete w.tags;
    fs.writeFileSync(path.join(staging, "workflows", f), JSON.stringify(w));
  }
  const oneOff = (...args) => docker(["run", "--rm", "-v", `${volume}:/home/node/.n8n`, "-v", `${staging}:/import:ro`, image, ...args]);
  oneOff("import:credentials", "--input=/import/credentials.json");
  out(`credential "CommerceOS API" imported${token ? "" : " with a placeholder: set COMMERCEOS_SERVICE_TOKEN in n8n/.env and run this again"}`);
  oneOff("import:workflow", "--separate", "--input=/import/workflows");
  out(`workflows imported: ${fs.readdirSync(path.join(n8nDir, "workflows")).filter((f) => f.endsWith(".json")).length}`);
  for (const id of PUBLISH) {
    oneOff("publish:workflow", `--id=${id}`);
    out(`published ${id}`);
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

// 4. Start n8n with the environment the workflows need
docker([
  "run", "-d", "--name", container, "--restart", "unless-stopped",
  "-p", "5678:5678",
  "-v", `${volume}:/home/node/.n8n`,
  "--add-host", "host.docker.internal:host-gateway",
  "--env-file", envFile,
  "-e", "GENERIC_TIMEZONE=Asia/Dhaka",
  "-e", "TZ=Asia/Dhaka",
  "-e", "N8N_BLOCK_ENV_ACCESS_IN_NODE=false",
  "-e", "NODE_FUNCTION_ALLOW_BUILTIN=crypto",
  image,
]);
for (let i = 0; i < 60; i++) {
  const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:5678/healthz"], { encoding: "utf8" });
  if (r.stdout === "200") {
    out("n8n is up at http://localhost:5678");
    process.exit(0);
  }
  spawnSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
}
out("n8n did not answer /healthz within 60 s: docker logs n8n");
process.exit(1);
