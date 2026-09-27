#!/usr/bin/env node
// PostToolUse scanner for CommerceOS.
// Scans only the NEW text written by Edit/Write/MultiEdit (not the whole file), so pre-existing debt
// doesn't generate noise. Blocking findings exit 2 (Claude must fix); warnings are added as context.
// Rules: .agent/rules/security.md, tenant-isolation.md, truthfulness.md, frontend.md.

const path = require("path");

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const ti = input.tool_input || {};
  const fp = String(ti.file_path || "");
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const rel = path.relative(root, path.resolve(root, fp)).split(path.sep).join("/");

  // Only scan application code and config; docs legitimately mention these patterns.
  const isCode = /\.(ts|tsx|js|cjs|mjs)$/.test(rel) && !rel.startsWith(".claude/") && !rel.startsWith("node_modules/");
  const isEnvExample = rel === ".env.example";
  if (!isCode && !isEnvExample) process.exit(0);

  const pieces = [];
  if (typeof ti.content === "string") pieces.push(ti.content);
  if (typeof ti.new_string === "string") pieces.push(ti.new_string);
  if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e && typeof e.new_string === "string") pieces.push(e.new_string);
  const text = pieces.join("\n");
  if (!text) process.exit(0);

  const isTest = rel.startsWith("tests/");
  const isTsx = rel.endsWith(".tsx");
  const blocking = [];
  const warnings = [];

  const check = (list, re, msg) => {
    const m = text.match(re);
    if (m) list.push(`${msg} (matched: \`${String(m[0]).slice(0, 60)}\`)`);
  };

  // --- Blocking: backdoors, credentials, client-controlled tenant ---
  check(blocking, /x-test-[a-z-]*(role|user|tenant|platform)/i, "Test/bypass header grants identity — backdoors are forbidden in every environment (rules/security.md §2, audit C3)");
  check(blocking, /master[_\s-]?pass(word)?/i, "Master password logic is forbidden (audit C1)");
  check(blocking, /postgres(ql)?:\/\/[^\s'"`:@]+:(?!PASSWORD|password|<)[^\s'"`@]{6,}@/i, "Looks like a real database credential — use env vars and placeholders (audit C5)");
  check(blocking, /\b(sk_live_[A-Za-z0-9]{8,}|pcsk_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})\b/, "Looks like a live API key — never commit secrets");
  if (!isTest && !isEnvExample) {
    check(blocking, /(body|payload|input|req\.body|searchParams\.get\(\s*["'`])\s*\.?\s*\[?["'`]?tenant_?[iI]d/, "tenant_id taken from client input — resolve it from extractRequestContext() (rules/tenant-isolation.md)");
    check(blocking, /\.\.\.\s*(body|\(?await request\.json\(\)\)?)(?![\w.])/, "Raw request body spread into a record (mass assignment, audit H4) — parse with a strict Zod schema and whitelist fields");
    check(warnings, /\.\.\.\s*(input|payload|data|updates)\b(?![\w.])/, "Object spread of an input-like value — fine only if it came from a strict Zod parse and can't carry id/tenant_id (audit H4)");
  }

  // --- Warnings: debt we shouldn't grow ---
  if (!isEnvExample) {
    check(warnings, /(:\s*any\b|\bas any\b|<any>)/, "New `any` — use `unknown` + Zod narrowing");
    if (!isTest) check(warnings, /console\.(log|debug|info)\(/, "New console logging — use the structured logger (skills/observability)");
    if (!isTest) check(warnings, /Math\.random\(\)/, "Math.random() — use crypto.randomUUID()/randomBytes for IDs/tokens; never for metrics (audit M4, H7)");
    check(warnings, /dangerouslySetInnerHTML/, "dangerouslySetInnerHTML — XSS risk (rules/platform-security.md #8)");
    check(warnings, /\b(plan|tier)\s*===?\s*["'`](PRO|STARTER|GROWTH|ENTERPRISE|FREE)/i, "Plan-name check — use the entitlement service (rules/platform-billing.md §2)");
    check(warnings, /role\s*===?\s*["'`](SUPER_ADMIN|OWNER|ADMIN)["'`]/, "Role-name check — use assertCan with a granular permission");
    if (isTsx) check(warnings, /["'`]#[0-9A-Fa-f]{3,8}["'`]|:\s*#[0-9A-Fa-f]{6}\b/, "Raw hex color in TSX — use tokens from src/styles/tokens.css");
    if (/src\/app\/api\/.*route\.ts$/.test(rel) && /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/.test(text) && !/assertCan\s*\(/.test(text)) {
      warnings.push("Mutation handler without assertCan in the new code — every mutation needs a permission check (audit H2). Ignore if the check is in unchanged lines.");
    }
    if (/success\s*:\s*true|status\s*:\s*["'`](SENT|DELIVERED|PAID|VERIFIED)["'`]/.test(text) && /(mock|stub|simulat|fake)/i.test(text)) {
      warnings.push("Simulated path appears to report success — must return SIMULATED/NOT_SENT (rules/truthfulness.md §2)");
    }
  }

  if (blocking.length) {
    process.stderr.write(
      `[commerceos scan] ${rel}: fix before continuing:\n- ${blocking.join("\n- ")}\n` +
        (warnings.length ? `Also:\n- ${warnings.join("\n- ")}\n` : "")
    );
    process.exit(2);
  }
  if (warnings.length) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `[commerceos scan] ${rel}:\n- ${warnings.join("\n- ")}`,
        },
      })
    );
  }
  process.exit(0);
});
