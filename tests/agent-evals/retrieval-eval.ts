/**
 * Retrieval eval (FX-82, audit F13): the customer agent's policy search (`KnowledgeService.searchPolicyDocuments`: top 2
 * distinct documents, no score cutoff) over the eval fixture's policies, 52 queries in English, Banglish and Bangla.
 *
 * Gate (nightly, real embeddings): Recall@2 ≥ 95% in every language, and an irrelevant document ranked first in at most
 * 15 of 52 queries. "Ranked first" counts every no-answer query (9), because the search always returns its closest
 * documents and the agent decides relevance; Recall@3 in the plan becomes Recall@2 because the tool returns 2 documents.
 *
 *   Offline (hashing embedder + BM25, report only): node tests/ts-runner.cjs ./tests/agent-evals/retrieval-eval.ts
 *   Nightly: EVAL_REAL_EMBEDDINGS=1 TEST_LLM_LIVE=1 LLM_EMBEDDING_BASE_URL=… LLM_EMBEDDING_MODEL=… (same command)
 */
import fs from "fs";
import path from "path";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import type { LLMProvider } from "@/domains/ai/providers/llm-provider.interface";
import { buildFixture } from "./fixture";
import { EVAL_DIR, localEmbedder } from "./harness";

const REAL = process.env.EVAL_REAL_EMBEDDINGS === "1" && process.env.TEST_LLM_LIVE === "1" && Boolean(process.env.LLM_EMBEDDING_BASE_URL);
const MIN_RECALL_AT_2 = 95;
const MAX_IRRELEVANT_FIRST = 15;

const QUERIES: Array<{ q: string; lang: string; expect: string | null }> = [
  { q: "how many days does delivery take outside Dhaka", lang: "en", expect: "Delivery Policy" },
  { q: "Rajshahi te delivery koto din lagbe", lang: "banglish", expect: "Delivery Policy" },
  { q: "ঢাকার বাইরে ডেলিভারি কত দিনে হয়?", lang: "bn", expect: "Delivery Policy" },
  { q: "is cash on delivery available in Sylhet", lang: "en", expect: "Delivery Policy" },
  { q: "COD ache sob district e?", lang: "banglish", expect: "Delivery Policy" },
  { q: "ক্যাশ অন ডেলিভারি আছে?", lang: "bn", expect: "Delivery Policy" },
  { q: "advance payment lagbe naki 6000 takar order e", lang: "banglish", expect: "Delivery Policy" },
  { q: "return policy", lang: "en", expect: "Return and Exchange Policy" },
  { q: "product ferot dite parbo koy diner moddhe", lang: "banglish", expect: "Return and Exchange Policy" },
  { q: "পণ্য ফেরত দেওয়ার নিয়ম কী?", lang: "bn", expect: "Return and Exchange Policy" },
  { q: "size na mille exchange kora jabe?", lang: "banglish", expect: "Return and Exchange Policy" },
  { q: "is the delivery charge refunded when I return", lang: "en", expect: "Return and Exchange Policy" },
  { q: "সাইজ পরিবর্তন করা যাবে?", lang: "bn", expect: "Return and Exchange Policy" },
  { q: "bkash e payment kora jay?", lang: "banglish", expect: "Payment Methods" },
  { q: "which payment methods do you accept", lang: "en", expect: "Payment Methods" },
  { q: "নগদে টাকা দেওয়া যাবে?", lang: "bn", expect: "Payment Methods" },
  { q: "apnara ki OTP chan?", lang: "banglish", expect: "Payment Methods" },
  { q: "t-shirt size chart", lang: "en", expect: "T-Shirt Size Guide" },
  { q: "XL size e chest koto inch", lang: "banglish", expect: "T-Shirt Size Guide" },
  { q: "টি-শার্টের সাইজ চার্ট দিন", lang: "bn", expect: "T-Shirt Size Guide" },
  { q: "what size fits a 40 inch chest", lang: "en", expect: "T-Shirt Size Guide" },
  { q: "support kokhon khola thake", lang: "banglish", expect: "Support Hours" },
  { q: "what time does your team reply", lang: "en", expect: "Support Hours" },
  { q: "আপনাদের অফিস কখন খোলা?", lang: "bn", expect: "Support Hours" },
  { q: "Chattogram e parcel pete koto din lage?", lang: "banglish", expect: "Delivery Policy" },
  { q: "চট্টগ্রামে পার্সেল পেতে কত দিন লাগে?", lang: "bn", expect: "Delivery Policy" },
  { q: "do you deliver to all districts with cash on delivery", lang: "en", expect: "Delivery Policy" },
  { q: "৫০০০ টাকার বেশি অর্ডারে কি অগ্রিম দিতে হয়?", lang: "bn", expect: "Delivery Policy" },
  { q: "bkash e advance kokhon lage?", lang: "banglish", expect: "Delivery Policy" },
  { q: "how long until I get my order inside dhaka city", lang: "en", expect: "Delivery Policy" },
  { q: "jinish pochondo na hole ferot dewa jabe?", lang: "banglish", expect: "Return and Exchange Policy" },
  { q: "ট্যাগ খুলে ফেললে কি ফেরত হবে?", lang: "bn", expect: "Return and Exchange Policy" },
  { q: "can I exchange for a bigger size", lang: "en", expect: "Return and Exchange Policy" },
  { q: "ডেলিভারি চার্জ কি ফেরত পাবো?", lang: "bn", expect: "Return and Exchange Policy" },
  { q: "return er time limit koto din", lang: "banglish", expect: "Return and Exchange Policy" },
  { q: "do you ever ask for my bkash pin", lang: "en", expect: "Payment Methods" },
  { q: "বিকাশে পেমেন্ট করা যায়?", lang: "bn", expect: "Payment Methods" },
  { q: "nagad e taka pathale hobe?", lang: "banglish", expect: "Payment Methods" },
  { q: "L size kon chest er jonno?", lang: "banglish", expect: "T-Shirt Size Guide" },
  { q: "৪২ ইঞ্চি বুকের জন্য কোন সাইজ?", lang: "bn", expect: "T-Shirt Size Guide" },
  { q: "is XXL bigger than 44 inch chest", lang: "en", expect: "T-Shirt Size Guide" },
  { q: "rat 9 tay message dile reply paibo?", lang: "banglish", expect: "Support Hours" },
  { q: "আপনারা কি শুক্রবারেও উত্তর দেন?", lang: "bn", expect: "Support Hours" },
  // No relevant document: the right answer is "nothing"
  { q: "do you sell gift cards", lang: "en", expect: null },
  { q: "অফিসের ঠিকানা কোথায়?", lang: "bn", expect: null },
  { q: "international shipping hoy?", lang: "banglish", expect: null },
  { q: "smart watch er warranty koto din?", lang: "banglish", expect: null },
  { q: "do you have a physical shop in Gulshan", lang: "en", expect: null },
  { q: "wholesale rate er list den", lang: "banglish", expect: null },
  { q: "জামদানি শাড়ি কিভাবে ধুতে হয়?", lang: "bn", expect: null },
  { q: "can I pay with a credit card in installments", lang: "en", expect: null },
  { q: "gift wrapping kora jay?", lang: "banglish", expect: null },
];

async function main() {
  if (!REAL) (modelRouter as unknown as { embeddingProvider: LLMProvider }).embeddingProvider = localEmbedder;
  const fx = await buildFixture();
  const rows: Array<{ q: string; lang: string; expect: string | null; got: string[] }> = [];
  for (const item of QUERIES) {
    if (REAL) await new Promise((r) => setTimeout(r, 1500)); // stay under the embedding provider's per-minute limit
    const docs = await KnowledgeService.searchPolicyDocuments(fx.tenantId, item.q, 2);
    rows.push({ q: item.q, lang: item.lang, expect: item.expect, got: docs.map((d) => d.title) });
  }
  const byLang: Record<string, { n: number; hit: number }> = {};
  for (const r of rows.filter((x) => x.expect)) {
    const k = (byLang[r.lang] ||= { n: 0, hit: 0 });
    k.n++;
    if (r.got.includes(r.expect!)) k.hit++;
  }
  const recall = Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, Math.round((v.hit / v.n) * 1000) / 10]));
  const irrelevantFirst = rows.filter((r) => r.got.length > 0 && r.got[0] !== r.expect).length;
  const out = { embeddings: REAL ? `real (${process.env.LLM_EMBEDDING_MODEL})` : "local hashing embedder + BM25", queries: rows.length, recall_at_2_by_language: recall, irrelevant_ranked_first: irrelevantFirst, rows };
  const dir = path.join(EVAL_DIR, "results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `retrieval-${REAL ? "real" : "offline"}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ embeddings: out.embeddings, recall_at_2_by_language: recall, irrelevant_ranked_first: `${irrelevantFirst}/${rows.length}` }, null, 2));
  const failures = [
    ...Object.entries(recall).filter(([, v]) => v < MIN_RECALL_AT_2).map(([k, v]) => `Recall@2 ${k} ${v}% < ${MIN_RECALL_AT_2}%`),
    ...(irrelevantFirst > MAX_IRRELEVANT_FIRST ? [`irrelevant document first in ${irrelevantFirst} > ${MAX_IRRELEVANT_FIRST} queries`] : []),
  ];
  if (failures.length) {
    console.error(`RETRIEVAL GATE ${REAL ? "FAILED" : "(offline, report only)"}:\n- ${failures.join("\n- ")}`);
    if (REAL) process.exit(1);
  } else console.log("RETRIEVAL GATE PASSED");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
