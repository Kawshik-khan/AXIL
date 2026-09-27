/**
 * Give the seeded demo accounts a real password (FIX_IMPLEMENTATION_PLAN FX-02 step 5, audit C1-b).
 *
 * The seeded accounts were stored with a hash that matches no password; they could only log in through the
 * shared-password backdoor removed in Phase 0. This script sets a bcrypt hash of SEED_ADMIN_PASSWORD on them.
 *
 *   1. Stop `npm run dev` — two processes writing the JSON store lose each other's updates.
 *   2. Put SEED_ADMIN_PASSWORD (at least 14 characters) in .env.local.
 *   3. Dry run:  node tests/ts-runner.cjs ./scripts/reset-seed-passwords.ts
 *      Apply:    node tests/ts-runner.cjs ./scripts/reset-seed-passwords.ts --apply   (backs up first)
 *
 * By default the four seeded platform staff accounts (support@, ops@, analyst@, security@) are set to DEACTIVATED,
 * keeping only admin@ (workspace owner) and superadmin@ usable; otherwise six accounts would share one password.
 * Pass --keep-staff to give the staff accounts the same password instead.
 */
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";

const out = (line: string) => process.stdout.write(`${line}\n`);

const OWNER_ACCOUNTS = ["admin@commerceos.io", "superadmin@commerceos.io"];
const STAFF_ACCOUNTS = ["support@commerceos.io", "ops@commerceos.io", "analyst@commerceos.io", "security@commerceos.io"];

const apply = process.argv.includes("--apply");
const deactivateStaff = !process.argv.includes("--keep-staff");
const seedPassword = process.env.SEED_ADMIN_PASSWORD;
if (!seedPassword || seedPassword.length < 14) {
  process.stderr.write("SEED_ADMIN_PASSWORD (at least 14 characters) must be set in .env.local.\n");
  process.exit(1);
}

const planned: Array<{ email: string; action: string; run: () => void }> = [];
const hash = bcrypt.hashSync(seedPassword, 12);

for (const email of [...OWNER_ACCOUNTS, ...STAFF_ACCOUNTS]) {
  const user = db.findUserByEmail(email);
  if (!user) {
    out(`skip   ${email} (not found)`);
    continue;
  }
  if (deactivateStaff && STAFF_ACCOUNTS.includes(email)) {
    planned.push({ email, action: "deactivate", run: () => db.updateUser(user.id, { status: "DEACTIVATED" }) });
  } else {
    planned.push({ email, action: "set password", run: () => db.updateUser(user.id, { password_hash: hash }) });
  }
}

for (const p of planned) out(`${apply ? "apply " : "plan  "} ${p.email}: ${p.action}`);

if (!apply) {
  out("Dry run only. Re-run with --apply to write these changes (a backup is taken first).");
  process.exit(0);
}

const dataFile = path.join(process.cwd(), ".data", "commerceos.json");
const backupDir = path.join(process.cwd(), ".backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `commerceos.json.before-seed-reset.${Date.now()}.bak`);
fs.copyFileSync(dataFile, backupFile);
out(`Backup written: ${path.relative(process.cwd(), backupFile)}`);

for (const p of planned) p.run();
out(`Done: ${planned.length} account(s) updated. Existing sessions for these users stay valid until they expire.`);
