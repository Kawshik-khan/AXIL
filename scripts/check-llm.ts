/**
 * Checks the configured LLM provider end to end: which provider and models are active, that a real chat call answers,
 * and that the answer follows an instruction (a strict JSON reply). Prints no keys.
 *
 * Usage: node tests/ts-runner.cjs ./scripts/check-llm.ts
 */
import { db } from "@/infrastructure/db";
import { modelRouter } from "@/domains/ai/providers/model-router";

async function main(): Promise<void> {
  await db.ready(); // the provider kill-switch check reads the store
  const status = modelRouter.getStatus();
  console.log(`mode:      ${status.mode}`);
  console.log(`provider:  ${status.provider}`);
  console.log(`fast:      ${status.models.TIER_1_FAST}`);
  console.log(`reasoning: ${status.models.TIER_2_REASONING}`);
  console.log(`embedding: ${status.models.TIER_3_EMBEDDING}`);
  console.log(`fallback:  ${status.fallback ?? "none"}`);
  console.log(`embedding provider: ${status.embedding_provider ?? "same as chat"}`);

  if (status.mode !== "LIVE") {
    console.log(`\nFAIL: the AI is ${status.mode}; no real provider will be called. Set LLM_BASE_URL and LLM_API_KEY.`);
    process.exit(1);
  }

  let failed = false;

  try {
    const r = await modelRouter.chatWithRouting("TIER_1_FAST", [
      { role: "system", content: "You are a concise assistant for a Bangladeshi online store." },
      {
        role: "user",
        content: 'Reply with ONLY a JSON object, no prose and no code fence: {"greeting": "<a short greeting in Bangla>", "sum": <the number 17 + 25>}',
      },
    ]);
    console.log(`\nchat: OK  model=${r.model}  ${r.latency_ms}ms  tokens=${r.usage.total_tokens}`);
    console.log(`raw reply: ${r.content.slice(0, 300)}`);
    const cleaned = r.content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try {
      const parsed = JSON.parse(cleaned) as { greeting?: unknown; sum?: unknown };
      const valid = typeof parsed.greeting === "string" && parsed.sum === 42;
      console.log(`valid output: ${valid ? "YES (JSON parsed, sum is 42)" : `NO (${JSON.stringify(parsed)})`}`);
      if (!valid) failed = true;
    } catch {
      console.log("valid output: NO (the reply is not JSON)");
      failed = true;
    }
  } catch (err) {
    console.log(`\nchat: FAIL  ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
  }

  try {
    const v = await modelRouter.generateEmbedding("delivery inside Dhaka");
    console.log(`\nembedding: OK  ${v.length} dimensions`);
  } catch (err) {
    console.log(`\nembedding: FAIL  ${err instanceof Error ? err.message : String(err)}  (knowledge search needs an embedding model)`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("check failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
