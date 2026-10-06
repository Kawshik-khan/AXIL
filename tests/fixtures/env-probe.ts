/**
 * Child process for tests/stage0-containment-tests.ts: prints which live-service settings this process can see
 * (true = set to a non-empty value), never the values themselves.
 */
const keys = ["DATABASE_URL", "QDRANT_URL", "UPSTASH_REDIS_REST_URL", "N8N_HOST", "LLM_BASE_URL", "TYPESAFE_API_KEY"];
const seen: Record<string, boolean> = {};
for (const key of keys) seen[key] = Boolean(process.env[key]);
process.stdout.write(`RESULT ${JSON.stringify(seen)}\n`);
