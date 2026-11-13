#!/usr/bin/env node
// PreToolUse guard for CommerceOS.
// Blocks edits to protected paths and shell commands that touch secrets/PII or delete core folders.
// Exit 2 + stderr = block the tool call and tell Claude why.

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
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

  const block = (msg) => {
    process.stderr.write(`[commerceos guard] ${msg}\n`);
    process.exit(2);
  };

  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const fp = ti.file_path || ti.notebook_path || "";
    const rel = path.relative(root, path.resolve(root, fp)).split(path.sep).join("/");
    const base = path.basename(rel);

    if (base.startsWith(".env") && base !== ".env.example") {
      block(`Editing ${rel} is not allowed — real secrets live there. Put placeholders in .env.example and ask the user to set real values.`);
    }
    const protectedPrefixes = [".data/", ".backups/", ".next/", "node_modules/"];
    for (const p of protectedPrefixes) {
      if (rel === p.slice(0, -1) || rel.startsWith(p)) {
        block(`${rel} is protected (${p} is runtime data, backups, build output, or dependencies). Change the code that produces it instead.`);
      }
    }
    if (base === "tsconfig.tsbuildinfo") block("tsconfig.tsbuildinfo is generated; don't edit it.");
  }

  if (tool === "Bash") {
    const cmd = String(ti.command || "");
    if (/\.env\.local\b/.test(cmd) && !/\.env\.local\.example/.test(cmd)) {
      block("Commands touching .env.local are blocked (live credentials). Ask the user to run it with `! <command>` if needed.");
    }
    if (/\.data\/commerceos\.json(?!\.tmp)/.test(cmd) && /\b(cat|less|more|head|tail|cp|mv|rm|>|jq|node)\b/.test(cmd)) {
      block(".data/commerceos.json holds customer PII (~39 MB). Inspect data through the app/services or ask the user.");
    }
    if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r)\s+[^;&|]*(\.data|\.agent|\.agents|\.claude|src|tests|n8n)(\/|\s|$)/.test(cmd)) {
      block("Recursive delete of a core folder is blocked. There is no git history here — ask the user first.");
    }
  }

  process.exit(0);
});
