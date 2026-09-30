/**
 * Migration check (production readiness R5): flags migration files that were added or changed in a pull request and
 * are unsafe for a deploy where the old version keeps serving during the migration (docs/render-runbook.md, "Migrations").
 *
 *   node scripts/check-migrations.mjs [baseRef]      baseRef defaults to origin/main
 *
 * Rules, for every added or modified src/infrastructure/db/migrations/*.sql:
 *   1. It must state its rollback: a line starting with "-- rollback:" (the SQL that undoes it, or "irreversible: <why>").
 *   2. DROP TABLE / DROP COLUMN / RENAME / SET NOT NULL / DROP CONSTRAINT / TRUNCATE / DELETE FROM need a line
 *      "-- allow-destructive: <reason>" saying why it is safe (the code that used it has already been released).
 *   3. An already applied migration must not be edited: a modified file (not a new one) fails.
 * Prints findings; exit 1 when there are any. Lists the migrations that are pending compared with the base.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const DIR = "src/infrastructure/db/migrations/";
const base = process.argv[2] || "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let changed;
try {
  changed = git("diff", "--name-status", `${base}...HEAD`, "--", DIR).split("\n").filter(Boolean);
} catch (err) {
  console.error(`Cannot diff against ${base}: ${err.message.split("\n")[0]}`);
  process.exit(2);
}

const DESTRUCTIVE = /\b(drop\s+(table|column|constraint|index)|rename\s+(to|column|table)|alter\s+table[^;]*\brename\b|set\s+not\s+null|truncate|delete\s+from)\b/i;
const problems = [];
const pending = [];
for (const line of changed) {
  const [status, file] = line.split("\t");
  if (!file || !file.endsWith(".sql") || file.includes("/legacy/")) continue;
  if (status.startsWith("D")) {
    problems.push(`${file}: a migration file was deleted`);
    continue;
  }
  if (!status.startsWith("A")) {
    problems.push(`${file}: an existing migration was modified; add a new migration instead`);
    continue;
  }
  pending.push(file);
  const text = fs.readFileSync(file, "utf8");
  if (!/^\s*--\s*rollback:/im.test(text)) problems.push(`${file}: no "-- rollback:" line`);
  const code = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  if (DESTRUCTIVE.test(code) && !/^\s*--\s*allow-destructive:\s*\S+/im.test(text)) {
    problems.push(`${file}: destructive statement without "-- allow-destructive: <reason>"`);
  }
}

console.log(pending.length ? `Pending migrations in this change:\n${pending.map((f) => `  ${f}`).join("\n")}` : "No new migrations in this change.");
if (problems.length) {
  console.error(`\nMigration check failed:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Migration check passed.");
