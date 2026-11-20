// Local-only probe: checks the LLM endpoint configured in an env file. Prints host, status codes, token usage and the
// reply only, never the key. Usage: node scripts/llm-probe.local.mjs .env.local
// With LLM_REASONING_EFFORT set, it also sends the same question once with reasoning_effort "low" and once with the
// configured value, so you can see whether the provider accepts the field and whether token usage changes.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(process.argv[2] || ".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const base = (env.LLM_BASE_URL || "").replace(/\/+$/, "");
const model = env.LLM_MODEL_FAST || env.LLM_MODEL || "gpt-oss:120b";
const effort = (env.LLM_REASONING_EFFORT || "").trim().toLowerCase();
process.stdout.write(
  `LLM_BASE_URL host: ${base ? new URL(base).host : "(unset)"} | key set: ${Boolean(env.LLM_API_KEY)} | ` +
    `AI_DEMO_MODE: ${env.AI_DEMO_MODE || "(unset)"} | model: ${model} | LLM_REASONING_EFFORT: ${effort || "(unset)"}\n`,
);
if (!base) process.exit(0);

const headers = {
  "content-type": "application/json",
  ...(env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {}),
};
const models = await fetch(`${base}/models`, { headers });
process.stdout.write(`GET /models -> ${models.status}\n`);
if (models.ok) {
  try {
    const ids = ((await models.json()).data || []).map((m) => m.id).filter(Boolean);
    process.stdout.write(`  models offered: ${ids.length ? ids.join(", ") : "(none listed)"}\n`);
  } catch {
    /* non-JSON body */
  }
}

async function chat(label, content, extra) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 1024, ...extra }),
  });
  const text = await res.text();
  if (!res.ok) {
    process.stdout.write(`POST /chat/completions [${label}] -> ${res.status} ${text.slice(0, 200)}\n`);
    return;
  }
  try {
    const data = JSON.parse(text);
    const u = data.usage || {};
    const reasoning = u.completion_tokens_details?.reasoning_tokens;
    process.stdout.write(
      `POST /chat/completions [${label}] -> ${res.status} | prompt ${u.prompt_tokens ?? "?"} | completion ${u.completion_tokens ?? "?"}` +
        `${reasoning !== undefined ? ` | reasoning ${reasoning}` : ""}\n`,
    );
    const reply = String(data.choices?.[0]?.message?.content ?? "");
    process.stdout.write(`  reply: ${reply.length > 160 ? `${reply.slice(0, 160)}... (${reply.length} chars)` : reply}\n`);
  } catch {
    process.stdout.write(`POST /chat/completions [${label}] -> ${res.status} (non-JSON body)\n`);
  }
}

await chat("no effort", "Reply with: pong", {});
if (effort) {
  // A question with some room to think, so a change in effort can show up in the completion tokens
  const q = "A shop sells a shirt for 650 taka. Delivery is 60 inside Dhaka, 120 outside. A customer in Sylhet buys 3. What is the total? Answer in one line.";
  await chat("question, no effort", q, {});
  await chat("question, effort low", q, { reasoning_effort: "low" });
  await chat(`question, effort ${effort}`, q, { reasoning_effort: effort });
}
