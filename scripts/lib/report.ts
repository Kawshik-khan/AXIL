import type { VerifyReport } from "@/infrastructure/store/backfill";
import type { RejectedRow } from "@/infrastructure/store/pg-store";

const out = (line: string) => process.stdout.write(`${line}\n`);

export function printVerifyReport(report: VerifyReport): void {
  for (const check of report.checks) out(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  for (const d of report.diffs.slice(0, 20)) {
    out(`        ${d.collection}: expected ${d.expected}, found ${d.actual}; missing ${d.missing.join(", ") || "-"}; unexpected ${d.unexpected.join(", ") || "-"}; different ${d.different.join(", ") || "-"}`);
  }
  out(report.pass ? "VERIFICATION PASS" : "VERIFICATION FAIL");
}

export function printRows(title: string, rows: RejectedRow[], limit = 50): void {
  if (!rows.length) return;
  out(`${title} (${rows.length}):`);
  for (const r of rows.slice(0, limit)) {
    out(`  ${r.collection}/${r.id || "(no id)"}  ${r.op}  ${r.reason}${r.constraint ? `  ${r.constraint}` : ""}`);
  }
  if (rows.length > limit) out(`  ... and ${rows.length - limit} more`);
}
