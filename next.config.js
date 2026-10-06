/** @type {import('next').NextConfig} */

// Baseline security headers (FIX_IMPLEMENTATION_PLAN FX-17, audit L2/L8).
// The Content-Security-Policy is Report-Only until CSP_ENFORCE=1 (FX-86): switch it once the monitoring job reports a full
// week without violations (`csp.ready_to_enforce`). Violations are counted at /api/v1/csp-report either way.
const CSP =
  "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; report-uri /api/v1/csp-report; report-to csp";
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: process.env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: CSP },
  { key: "Reporting-Endpoints", value: 'csp="/api/v1/csp-report"' },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig = {
  // src/instrumentation.ts loads the Postgres-backed store at server start (ADR-108); no flag needed since Next 15.
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
