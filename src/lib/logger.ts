/**
 * Minimal structured logger (JSON lines) — see .agent/skills/observability/SKILL.md.
 * Never pass secrets, tokens, full phone numbers, addresses, or message bodies in `fields`.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  request_id?: string;
  trace_id?: string;
  tenant_id?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  if (level === "error") {
    process.stderr.write(`${line}\n`);
  } else if (level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
