/**
 * Section-level retrieval eval (2026-10-29): eight real-shaped store documents (fixtures/taga, a sample clothing store
 * written as merchants upload them, one "##" section per topic). Checks what the knowledge search tester and the
 * customer agent see: the right SECTION ranked first, scores that still separate results (not a wall of 1.0), and
 * no evidence released for questions the documents do not answer.
 *
 *   Offline (hashing embedder + BM25, part of npm test): node tests/ts-runner.cjs ./tests/agent-evals/section-eval.ts
 *   Real embeddings: EVAL_REAL_EMBEDDINGS=1 TEST_LLM_LIVE=1 LLM_EMBEDDING_BASE_URL=… LLM_EMBEDDING_MODEL=… (same command)
 */
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import type { LLMProvider } from "@/domains/ai/providers/llm-provider.interface";
import type { KnowledgeDocumentType } from "@/types/ai";
import type { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { EVAL_DIR, localEmbedder } from "./harness";

const REAL = process.env.EVAL_REAL_EMBEDDINGS === "1" && process.env.TEST_LLM_LIVE === "1" && Boolean(process.env.LLM_EMBEDDING_BASE_URL);
const FIXTURE_DIR = path.join(EVAL_DIR, "fixtures", "taga");

// Offline floors (2026-10-29, reranker rewrite): the old additive score ranked the right section first in 9 of 23,
// clamped 16 scores to 1.0 and released evidence for 1 of 5 unanswerable questions; the rewrite measured 20/23, 0, 1/5
const MIN_SECTION_HIT_AT_1 = 19;
const MIN_ANSWERABLE_RELEASED = 22;
const MAX_SATURATED_SCORES = 0;
const MIN_UNANSWERABLE_ABSTAINED = 4;

const DOCS: Array<{ file: string; title: string; type: KnowledgeDocumentType }> = [
  { file: "01-return-exchange-policy.md", title: "Return & Exchange Policy", type: "RETURN_POLICY" },
  { file: "02-shipping-delivery.md", title: "Shipping & Delivery", type: "SHIPPING_POLICY" },
  { file: "03-product-faq-care.md", title: "Product FAQ & Care", type: "FAQ" },
  { file: "04-size-chart.md", title: "Size Chart", type: "SIZE_GUIDE" },
  { file: "04-size-guide-how-to-measure.md", title: "Size Guide", type: "SIZE_GUIDE" },
  { file: "05-payment-cod.md", title: "Payment & COD", type: "PAYMENT_POLICY" },
  { file: "06-warranty-guarantee.md", title: "Warranty & Guarantee", type: "WARRANTY" },
  { file: "07-store-information.md", title: "Store Information", type: "BUSINESS_INFO" },
];

const FAQ = "FREQUENTLY ASKED";

/** `sections` lists headings where one (substring of the section heading) in `doc` answers the question. */
const QUERIES: Array<{ q: string; lang: string; doc: string | null; sections?: string[] }> = [
  { q: "ভুল সাইজ এসেছে, কী করবো?", lang: "bn", doc: "Return & Exchange Policy", sections: ["DAMAGED, DEFECTIVE OR WRONG PRODUCT", "SIZE EXCHANGE", FAQ] },
  { q: "exchange korte koto din somoy pabo?", lang: "banglish", doc: "Return & Exchange Policy", sections: ["EXCHANGE TIME WINDOW", FAQ] },
  { q: "Can I return innerwear?", lang: "en", doc: "Return & Exchange Policy", sections: ["ITEMS THAT CANNOT BE EXCHANGED"] },
  { q: "refund bKash e koto din e pabo?", lang: "banglish", doc: "Return & Exchange Policy", sections: ["REFUND OPTIONS", FAQ] },
  { q: "ঢাকার বাইরে ডেলিভারি চার্জ কত?", lang: "bn", doc: "Shipping & Delivery", sections: ["DELIVERY CHARGES", FAQ] },
  { q: "what is the delivery charge inside Dhaka", lang: "en", doc: "Shipping & Delivery", sections: ["DELIVERY CHARGES", FAQ] },
  { q: "Chittagong e parcel pete koto din lagbe?", lang: "banglish", doc: "Shipping & Delivery", sections: ["DELIVERY TIME", FAQ] },
  { q: "kon courier e pathan?", lang: "banglish", doc: "Shipping & Delivery", sections: ["COURIER PARTNERS", FAQ] },
  { q: "cotton t-shirt kivabe dhubo?", lang: "banglish", doc: "Product FAQ & Care", sections: ["WASHING GUIDE"] },
  { q: "how should I wash denim jeans", lang: "en", doc: "Product FAQ & Care", sections: ["WASHING GUIDE"] },
  { q: "does cotton shrink after washing", lang: "en", doc: "Product FAQ & Care", sections: ["SHRINKAGE", FAQ] },
  { q: "amar chest 38 inch, kon size t-shirt nibo?", lang: "banglish", doc: null, sections: ["QUICK SIZE GUIDE (Men T-shirt", "Men T-Shirt size chart", "CHOOSING YOUR SIZE", FAQ] },
  { q: "women kurti M size bust koto inch?", lang: "banglish", doc: null, sections: ["Women Kurti size chart", "QUICK SIZE GUIDE (Women kurti"] },
  { q: "men jeans 32 waist length", lang: "en", doc: "Size Chart", sections: ["Men Jeans size chart"] },
  { q: "বিকাশে কিভাবে পেমেন্ট করবো?", lang: "bn", doc: "Payment & COD", sections: ["bKash PAYMENT GUIDE", FAQ] },
  { q: "6000 takar order e advance lagbe?", lang: "banglish", doc: "Payment & COD", sections: ["ADVANCE DELIVERY FEE RULES"] },
  { q: "how do I pay with Nagad merchant", lang: "en", doc: "Payment & COD", sections: ["NAGAD PAYMENT GUIDE"] },
  { q: "zipper warranty koto din?", lang: "banglish", doc: null, sections: ["GUARANTEE DURATION", "WARRANTY ON CLOTHING"] },
  { q: "what is not covered by the guarantee", lang: "en", doc: "Warranty & Guarantee", sections: ["WHAT IS NOT COVERED"] },
  { q: "dokan kokhon khola thake?", lang: "banglish", doc: "Store Information", sections: ["OUTLET OPENING HOURS", FAQ] },
  { q: "Uttara te outlet ache?", lang: "banglish", doc: "Store Information", sections: ["PHYSICAL OUTLETS", FAQ] },
  { q: "customer support hotline number", lang: "en", doc: "Store Information", sections: ["CUSTOMER SUPPORT"] },
  { q: "bulk order for my office with logo printing", lang: "en", doc: "Store Information", sections: ["WHOLESALE & CORPORATE ORDERS"] },
  // Nothing in the documents answers these: the search must release no evidence
  { q: "do you sell laptops?", lang: "en", doc: null },
  { q: "iPhone er dam koto?", lang: "banglish", doc: null },
  { q: "gift card kinte parbo?", lang: "banglish", doc: null },
  { q: "international shipping hoy?", lang: "banglish", doc: null },
  { q: "গাড়ি ভাড়া পাওয়া যাবে?", lang: "bn", doc: null },
];

function ctxFor(tenant: { id: string; name: string; slug: string }, user: { id: string; email: string; name: string }): RequestContext {
  return {
    requestId: "req_section_eval", traceId: "tr_section_eval",
    user: { id: user.id, email: user.email, name: user.name, status: "ACTIVE" },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER", permissions: Object.values(PERMISSIONS), timestamp: new Date().toISOString(),
  };
}

async function main() {
  if (!REAL) (modelRouter as unknown as { embeddingProvider: LLMProvider }).embeddingProvider = localEmbedder;
  db.clearAllForTesting();
  const owner = await AuthService.registerTenantWithOwner({ workspaceName: "TAGA", name: "Section Eval Owner", email: `section-eval-${Date.now()}@example.com`, password: "EvalOnly-Pass-2026!", currency: "BDT" });
  const ctx = ctxFor(owner.tenant, owner.user);
  for (const d of DOCS) {
    await KnowledgeService.ingestDocument(ctx, { title: d.title, document_type: d.type, raw_content: fs.readFileSync(path.join(FIXTURE_DIR, d.file), "utf8"), language: "mixed" });
  }

  const rows: Array<{ q: string; lang: string; expect: string | null; top: string | null; scores: number[]; sectionHit?: boolean; agentDocs: string[] }> = [];
  for (const item of QUERIES) {
    if (REAL) await new Promise((r) => setTimeout(r, 4000));
    const hits = await KnowledgeService.searchKnowledge(owner.tenant.id, item.q, 3); // the search tester's default cutoff
    const agentDocs = (await KnowledgeService.searchPolicyDocuments(owner.tenant.id, item.q, 2)).map((d) => d.title);
    const first = hits[0];
    const sectionHit = item.sections
      ? Boolean(first && (!item.doc || first.document_title === item.doc) && item.sections.some((s) => first.section.includes(s)))
      : undefined;
    rows.push({
      q: item.q, lang: item.lang, expect: item.sections ? `${item.doc ?? "*"} > ${item.sections.join(" | ")}` : null,
      top: first ? `${first.document_title} > ${first.section}` : null, scores: hits.map((h) => h.similarity_score), sectionHit, agentDocs,
    });
  }

  const answerable = rows.filter((r) => r.expect);
  const unanswerable = rows.filter((r) => !r.expect);
  const sectionHitAt1 = answerable.filter((r) => r.sectionHit).length;
  const saturated = rows.reduce((n, r) => n + r.scores.filter((s) => s >= 0.999).length, 0);
  const tiedTop = rows.filter((r) => r.scores.length >= 2 && r.scores[0] === r.scores[1]).length;
  const abstained = unanswerable.filter((r) => r.scores.length === 0).length;
  const released = answerable.filter((r) => r.scores.length > 0).length;
  const out = {
    embeddings: REAL ? `real (${process.env.LLM_EMBEDDING_MODEL})` : "local hashing embedder + BM25",
    section_hit_at_1: `${sectionHitAt1}/${answerable.length}`,
    answerable_released: `${released}/${answerable.length}`,
    saturated_scores: saturated,
    tied_top_two: `${tiedTop}/${rows.length}`,
    unanswerable_abstained: `${abstained}/${unanswerable.length}`,
    misses: answerable.filter((r) => !r.sectionHit).map((r) => ({ q: r.q, expect: r.expect, top: r.top, scores: r.scores })),
    released_for_unanswerable: unanswerable.filter((r) => r.scores.length > 0).map((r) => ({ q: r.q, top: r.top, scores: r.scores })),
  };
  const dir = path.join(EVAL_DIR, "results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `section-${REAL ? "real" : "offline"}.json`), JSON.stringify({ ...out, rows }, null, 2));
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (REAL) process.exit(0); // floors are offline-calibrated; the real-embeddings run reports
  const failures = [
    ...(sectionHitAt1 < MIN_SECTION_HIT_AT_1 ? [`right section first in ${sectionHitAt1} < ${MIN_SECTION_HIT_AT_1}`] : []),
    ...(released < MIN_ANSWERABLE_RELEASED ? [`evidence released for ${released} < ${MIN_ANSWERABLE_RELEASED} answerable questions`] : []),
    ...(saturated > MAX_SATURATED_SCORES ? [`${saturated} scores clamped at 1.0`] : []),
    ...(abstained < MIN_UNANSWERABLE_ABSTAINED ? [`abstained on ${abstained} < ${MIN_UNANSWERABLE_ABSTAINED} unanswerable questions`] : []),
  ];
  if (failures.length) {
    process.stderr.write(`SECTION RETRIEVAL GATE (offline) FAILED:\n- ${failures.join("\n- ")}\n`);
    process.exit(1);
  }
  process.stdout.write("SECTION RETRIEVAL GATE (offline) PASSED\n");
  process.exit(0);
}
main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
