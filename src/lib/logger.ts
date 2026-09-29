/**
 * Minimal structured logger (JSON lines) — see .agent/skills/observability/SKILL.md.
 * Never pass secrets, tokens, full phone numbers, addresses, or message bodies in `fields`. As a backstop, values under
 * keys that look like credentials (token, secret, password, authorization, api key, cookie, signature) are replaced
 * with "[REDACTED]" when they are strings, also in nested objects.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  request_id?: string;
  trace_id?: string;
  tenant_id?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

const SECRET_KEY = /(token|secret|passw(or)?d|authorization|api[_-]?key|cookie|signature|credential)/i;
/** Names of things, not the things: `service_token_id`, `secret_reference`, `token_count`, `signature_at` stay. */
const NOT_A_SECRET = /(_ids?|_ref(erence)?|_name|_count|_at|_type)$/i;

function redact(value: unknown, depth: number): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    // Strings only: counts such as `input_tokens` stay readable
    out[key] = SECRET_KEY.test(key) && !NOT_A_SECRET.test(key) && typeof v === "string" ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...(redact(fields, 0) as LogFields) });
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
