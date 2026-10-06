import { apiError } from "@/lib/api-response";
import { clientKey, enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { CspReportService, parseCspReports } from "@/domains/platform/services/csp-report.service";
import { withStore } from "@/lib/store-unit";

const MAX_BYTES = 16 * 1024;

/**
 * Browsers' Content-Security-Policy violation reports (FX-86). Public by nature (the browser sends them without a
 * session), so: small bodies only, rate limited per client and overall, and only counters are stored.
 */
async function handlePOST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return new Response(null, { status: 413 });
    const text = await readCapped(request);
    if (text === null) return new Response(null, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const violations = parseCspReports(body);
    if (!violations.length) return new Response(null, { status: 204 }); // nothing to count, and no budget spent
    try {
      const client = clientKey(request);
      if (client) await enforceRateLimit(`csp:${client}`, 30, MINUTE);
      await enforceRateLimit("csp:all", 600, MINUTE);
    } catch (err) {
      CspReportService.recordDropped(violations.length); // a flood must not make the week look clean
      throw err;
    }
    CspReportService.recordParsed(violations);
    return new Response(null, { status: 204 });
  } catch (err) {
    return apiError(err);
  }
}

/** The body as text, or null past MAX_BYTES (read in chunks, so a large body is never held whole). */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const POST = withStore("POST", handlePOST);
