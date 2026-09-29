/**
 * The only way server code calls an external URL (FIX_IMPLEMENTATION_PLAN Phase 5, FX-53/54/55; audit M17; ADR-110).
 *
 * SSRF guard:
 *   - http/https only, no user:password@ in the URL; https required unless the host is on the platform allow-list;
 *   - every address the host resolves to is checked when the connection is made (not only when the URL was saved), so
 *     a DNS answer that changes to a private address is refused too; IP literals are checked directly;
 *   - refused: loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, "this network", multicast,
 *     reserved and documentation ranges, IPv6 unique-local / link-local, and IPv4 embedded in IPv6;
 *   - redirects are never followed (a 3xx is returned as the response);
 *   - OUTBOUND_ALLOWED_PRIVATE_HOSTS (platform env, comma-separated host:port, e.g. "localhost:5678" for a local n8n)
 *     is the only way to reach a private address with a URL that tenants can influence;
 *   - `platformConfigured: true` is for URLs read from the platform's own environment (LLM_BASE_URL, N8N_HOST, …),
 *     which may point at a local server: it skips the https and private-address rules, nothing else. Never set it for
 *     a URL that came from a request, a tenant setting or a stored record.
 * Limits: a deadline for the whole request (default 5 s) and a response size cap (default 1 MB, truncated).
 * Errors say which host failed and why, never the path, query, headers or body (they can carry keys).
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { AppError } from "@/lib/errors";

export class OutboundBlockedError extends AppError {
  constructor(reason: string) {
    super("OUTBOUND_URL_BLOCKED", `This address can't be used: ${reason}.`, 422);
  }
}

export class OutboundTimeoutError extends AppError {
  constructor(host: string, timeoutMs: number) {
    super("OUTBOUND_TIMEOUT", `${host} did not answer within ${Math.round(timeoutMs / 100) / 10} s.`, 504);
  }
}

export class OutboundNetworkError extends AppError {
  constructor(host: string, code: string) {
    super("OUTBOUND_UNREACHABLE", `${host} could not be reached (${code}).`, 502);
  }
}

export interface OutboundRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Whole-request deadline (connect + send + response). */
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** The URL comes from the platform's environment, not from tenant data (see the header). */
  platformConfigured?: boolean;
}

export interface OutboundResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** UTF-8 text, cut at maxResponseBytes. */
  body: string;
  truncated: boolean;
  durationMs: number;
}

export type OutboundTransport = (url: URL, options: Required<Pick<OutboundRequestOptions, "method" | "timeoutMs">> & OutboundRequestOptions) => Promise<OutboundResponse>;
type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

// ---- Address policy --------------------------------------------------------------------------------------------------

const blocked = new net.BlockList();
for (const [range, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  blocked.addSubnet(range, prefix, "ipv4");
}
for (const [range, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible (deprecated)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds any IPv4)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(range, prefix, "ipv6");
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d or ::ffff:xxxx:xxxx), else null. */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True when an IP address must never be contacted (unless its host is allow-listed). */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(bare);
  if (family === 4) return blocked.check(bare, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(bare);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(bare, "ipv6");
  }
  return true; // not an IP address at all
}

function allowListedHosts(): Set<string> {
  return new Set(
    (process.env.OUTBOUND_ALLOWED_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hostKey(url: URL): string {
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.hostname.replace(/^\[|\]$/g, "").toLowerCase()}:${port}`;
}

/** Whether the platform allow-list names this URL's host and port (the only way to reach a private address). */
export function isAllowListed(url: URL): boolean {
  return allowListedHosts().has(hostKey(url));
}

/**
 * Checks a URL's form: http(s), no credentials, https unless allow-listed, not an IP literal in a refused range.
 * Returns the parsed URL. Use it where a URL is saved (webhook targets, endpoints) for a clear error up front.
 */
export function parseSafeUrl(raw: string, options: { platformConfigured?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundBlockedError("it is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new OutboundBlockedError("only https URLs are allowed");
  if (url.username || url.password) throw new OutboundBlockedError("URLs with a user name or password are not allowed");
  if (!url.hostname) throw new OutboundBlockedError("the URL has no host");
  const allowListed = options.platformConfigured === true || isAllowListed(url);
  if (url.protocol === "http:" && !allowListed) throw new OutboundBlockedError("only https URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowListed && net.isIP(host) && isBlockedAddress(host)) throw new OutboundBlockedError("private, loopback and link-local addresses are not allowed");
  if (!allowListed && /(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) {
    throw new OutboundBlockedError("private, loopback and link-local addresses are not allowed");
  }
  return url;
}

let lookupForTesting: LookupFn | null = null;
let transportForTesting: OutboundTransport | null = null;

async function resolveHost(hostname: string): Promise<Array<{ address: string; family: number }>> {
  if (lookupForTesting) return lookupForTesting(hostname);
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

/** Like parseSafeUrl, and also resolves the host now and refuses it if any address is in a refused range. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  const url = parseSafeUrl(raw);
  if (isAllowListed(url)) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return url;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new OutboundBlockedError(`${host} does not resolve`);
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new OutboundBlockedError("private, loopback and link-local addresses are not allowed");
  }
  return url;
}

// ---- Request ---------------------------------------------------------------------------------------------------------

/**
 * Sends one request under the policy above. Never follows redirects. Throws OutboundBlockedError, OutboundTimeoutError
 * or OutboundNetworkError; any HTTP status (including 4xx/5xx and 3xx) is returned, not thrown.
 */
export async function outboundRequest(raw: string, options: OutboundRequestOptions = {}): Promise<OutboundResponse> {
  const url = parseSafeUrl(raw, { platformConfigured: options.platformConfigured });
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (transportForTesting) return transportForTesting(url, { ...options, method, timeoutMs });
  const allowListed = options.platformConfigured === true || isAllowListed(url);
  const maxBytes = options.maxResponseBytes ?? 1_048_576;
  const started = Date.now();
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // Every address is checked when the socket connects (IP literals skip lookup, so they were checked in parseSafeUrl)
  const lookup: net.LookupFunction = (hostname, lookupOptions, callback) => {
    resolveHost(hostname).then(
      (addresses) => {
        const usable = allowListed ? addresses : addresses.filter((a) => !isBlockedAddress(a.address));
        if (!usable.length || usable.length !== addresses.length) {
          callback(new OutboundBlockedError("private, loopback and link-local addresses are not allowed"), "", 4);
          return;
        }
        if ((lookupOptions as dns.LookupOptions).all) (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 4)
    );
  };

  const body = options.body === undefined ? undefined : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, "utf8");
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (body) headers["content-length"] = String(body.length);

  return new Promise<OutboundResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const request = (url.protocol === "https:" ? https : http).request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        lookup,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = maxBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, Math.max(0, room)));
            size = maxBytes;
            truncated = true;
            response.destroy();
            finish(() =>
              resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8"), truncated, durationMs: Date.now() - started })
            );
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        response.on("end", () =>
          finish(() =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8"), truncated, durationMs: Date.now() - started })
          )
        );
        response.on("error", (err: NodeJS.ErrnoException) => finish(() => reject(new OutboundNetworkError(host, err.code ?? "RESPONSE_ERROR"))));
      }
    );
    const deadline = setTimeout(() => {
      finish(() => reject(new OutboundTimeoutError(host, timeoutMs)));
      request.destroy();
    }, timeoutMs);
    request.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof OutboundBlockedError) finish(() => reject(err));
      else finish(() => reject(new OutboundNetworkError(host, err.code ?? "NETWORK_ERROR")));
    });
    if (body) request.write(body);
    request.end();
  });
}

/** Tests: answer every request from this function instead of the network (URL checks still apply). null restores. */
export function setOutboundTransportForTesting(transport: OutboundTransport | null): void {
  transportForTesting = transport;
}

/** Tests: resolve host names with this function (to simulate DNS answers). null restores. */
export function setOutboundLookupForTesting(lookup: LookupFn | null): void {
  lookupForTesting = lookup;
}
