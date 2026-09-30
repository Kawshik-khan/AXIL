/**
 * Dependency audit gate (production readiness R5): fails when `npm audit --omit=dev` reports a high or critical advisory
 * that is not listed, with a reason and an expiry date, in security/audit-exceptions.json. An expired exception fails
 * too, so an accepted risk is re-examined instead of forgotten.
 *
 *   node scripts/audit-gate.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("npm audit did not return JSON (registry unreachable?)");
  process.exit(2);
}

const exceptions = JSON.parse(fs.readFileSync("security/audit-exceptions.json", "utf8")).exceptions ?? [];
const today = new Date().toISOString().slice(0, 10);
const byId = new Map(exceptions.map((e) => [e.id, e]));
const problems = [];

for (const e of exceptions) {
  if (!e.reason || !e.expires) problems.push(`${e.id}: an exception needs "reason" and "expires"`);
  else if (e.expires < today) problems.push(`${e.id}: exception expired on ${e.expires}; fix it or renew it with a new reason`);
}

const seen = new Set();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = String(via.url ?? "").split("/").pop() || via.title;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!byId.has(id)) problems.push(`${name}: ${via.severity} ${id} - ${via.title}`);
  }
}

const meta = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit: ${meta.critical ?? 0} critical, ${meta.high ?? 0} high; ${seen.size} distinct advisories, ${exceptions.length} accepted exceptions`);
if (problems.length) {
  console.error(`\nAudit gate failed:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Audit gate passed.");
