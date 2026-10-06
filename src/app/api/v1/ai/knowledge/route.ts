import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const docs = await KnowledgeService.listDocuments(context);
    return apiSuccess(docs, { total: docs.length });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * Text formats only (FX-36 M16): there's no server-side PDF/DOCX parser, and the browser's regex "PDF extraction"
 * turned binary files into garbage chunks.
 */
const TEXT_FORMATS = { TXT: "TXT", TEXT: "TXT", MARKDOWN: "MARKDOWN", MD: "MARKDOWN", CSV: "CSV", JSON: "JSON", HTML: "HTML", MANUAL_TEXT: "MANUAL_TEXT" } as const;

const IngestBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    document_type: z.string().trim().min(1).max(64).optional(),
    raw_content: z.string().min(1).max(2_000_000),
    file_format: z
      .string()
      .toUpperCase()
      .refine((f): f is keyof typeof TEXT_FORMATS => f in TEXT_FORMATS, {
        message: "Only text files (TXT, Markdown, CSV, JSON) can be added; PDF and Word need a parser that doesn't exist yet.",
      })
      .optional(),
    tags: z.array(z.string().max(64)).max(20).optional(),
    language: z.enum(["bn", "en", "mixed"]).optional(),
    /** false: staff-only; the customer agent never quotes it (FX-82 review) */
    customer_visible: z.boolean().optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const body = IngestBody.parse(await request.json());

    const doc = await KnowledgeService.ingestDocument(context, {
      title: body.title,
      document_type: (body.document_type || "RETURN_POLICY") as never,
      raw_content: body.raw_content,
      file_format: body.file_format ? TEXT_FORMATS[body.file_format as keyof typeof TEXT_FORMATS] : "MARKDOWN",
      tags: body.tags,
      language: body.language,
      customer_visible: body.customer_visible,
    });

    return apiSuccess(doc, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
export const POST = withStore("POST", handlePOST);
