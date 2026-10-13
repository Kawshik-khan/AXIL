/**
 * Landing page routing and truthfulness: a visitor without a session sees the public landing page at `/`, a signed-in
 * person still gets the dashboard, and the page's prices match the seeded plans.
 * Run: node tests/ts-runner.cjs ./tests/landing-routing-tests.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { proxy, config, WORKSPACE_SESSION_COOKIES } from "@/proxy";
import { AUTH_COOKIE_NAME } from "@/lib/security";
import { IMPERSONATION_COOKIE_NAME } from "@/lib/impersonation";
import { PLANS } from "@/components/marketing/plans";

let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓ PASS\x1b[0m - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗ FAIL\x1b[0m - ${name}\n      ${(err as Error).message}`);
  }
}

function request(pathname: string, cookies: string[] = []): NextRequest {
  const headers = new Headers();
  if (cookies.length) headers.set("cookie", cookies.map((name) => `${name}=x`).join("; "));
  return new NextRequest(`http://localhost:3000${pathname}`, { headers });
}

const rewrittenTo = (res: Response): string | null => res.headers.get("x-middleware-rewrite");
const passedThrough = (res: Response): boolean => res.headers.get("x-middleware-next") === "1";

/** Runs fn with NODE_ENV / DEV_AUTH_BYPASS set, then restores them. */
function withEnv(env: { nodeEnv: string; bypass?: string }, fn: () => void): void {
  const e = process.env as Record<string, string | undefined>;
  const saved = { node: e.NODE_ENV, bypass: e.DEV_AUTH_BYPASS };
  e.NODE_ENV = env.nodeEnv;
  if (env.bypass === undefined) delete e.DEV_AUTH_BYPASS;
  else e.DEV_AUTH_BYPASS = env.bypass;
  try {
    fn();
  } finally {
    if (saved.node === undefined) delete e.NODE_ENV;
    else e.NODE_ENV = saved.node;
    if (saved.bypass === undefined) delete e.DEV_AUTH_BYPASS;
    else e.DEV_AUTH_BYPASS = saved.bypass;
  }
}

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), "utf8");

async function main(): Promise<void> {
  console.log("\n  Landing page routing\n");

  await runTest("a visitor with no session sees the landing page at /", () => {
    withEnv({ nodeEnv: "production" }, () => {
      const target = rewrittenTo(proxy(request("/")));
      assert.ok(target && new URL(target).pathname === "/welcome", `expected a rewrite to /welcome, got ${target}`);
    });
  });

  await runTest("a signed-in person still gets the dashboard at /", () => {
    withEnv({ nodeEnv: "production" }, () => {
      assert.ok(passedThrough(proxy(request("/", [AUTH_COOKIE_NAME]))));
    });
  });

  await runTest("an operator inside a support session still gets the dashboard at /", () => {
    withEnv({ nodeEnv: "production" }, () => {
      assert.ok(passedThrough(proxy(request("/", [IMPERSONATION_COOKIE_NAME]))));
    });
  });

  await runTest("a platform operator's own cookie is not a workspace session", () => {
    withEnv({ nodeEnv: "production" }, () => {
      const target = rewrittenTo(proxy(request("/", ["commerceos_platform_session"])));
      assert.ok(target && new URL(target).pathname === "/welcome");
    });
  });

  await runTest("no other path is rewritten", () => {
    withEnv({ nodeEnv: "production" }, () => {
      for (const p of ["/orders", "/login", "/api/v1/auth/session", "/welcome", "/super-admin"]) {
        const res = proxy(request(p));
        assert.ok(passedThrough(res) && rewrittenTo(res) === null, `${p} must pass through`);
      }
    });
  });

  await runTest("the opt-in dev bypass keeps opening the dashboard, in development only", () => {
    withEnv({ nodeEnv: "development", bypass: "1" }, () => {
      assert.ok(passedThrough(proxy(request("/"))));
    });
    withEnv({ nodeEnv: "production", bypass: "1" }, () => {
      assert.ok(rewrittenTo(proxy(request("/"))), "the bypass must never apply in production");
    });
    withEnv({ nodeEnv: "development" }, () => {
      assert.ok(rewrittenTo(proxy(request("/"))), "without the opt-in, development shows the landing page");
    });
  });

  await runTest("the proxy runs for / only, so API routes and assets are untouched", () => {
    assert.strictEqual(config.matcher, "/");
  });

  await runTest("the cookie names in the proxy match the ones the app sets", () => {
    assert.deepStrictEqual([...WORKSPACE_SESSION_COOKIES], [AUTH_COOKIE_NAME, IMPERSONATION_COOKIE_NAME]);
  });

  console.log("\n  Landing page content\n");

  await runTest("the prices and seat counts on the page match the seeded plans", () => {
    const source = read("src/infrastructure/db/index.ts");
    for (const plan of PLANS) {
      const version = new RegExp(
        `plan_id: "${plan.id}", version: 1, billing_period: "MONTHLY", price_bdt: (\\d+), is_published: true, features: \\{ max_users: (\\d+)`,
      ).exec(source);
      assert.ok(version, `no seeded plan version found for ${plan.id}`);
      assert.strictEqual(Number(version[1]), plan.price, `${plan.id} price differs from the seed`);
      assert.strictEqual(Number(version[2]), plan.users, `${plan.id} staff users differ from the seed`);
    }
  });

  await runTest("the page lists only limits the platform enforces", () => {
    const catalog = read("src/domains/platform/entitlement-catalog.ts");
    // Orders per month, automations, n8n, storage and priority support have `enforcedBy: null`: they must not be promised.
    const page = ["Pricing", "Landing", "Faq"].map((f) => read(`src/components/marketing/${f}.tsx`)).join("\n");
    assert.ok(/enforcedBy: null/.test(catalog), "this guard assumes some limits are still unenforced");
    for (const promise of [/orders per month/i, /monthly order/i, /priority support/i, /dedicated SLA/i, /n8n executions/i]) {
      assert.ok(!promise.test(page), `the landing page promises ${promise}, which is not enforced`);
    }
  });

  await runTest("the landing code has no raw colors and calls no API", () => {
    for (const file of ["Landing.tsx", "Pricing.tsx", "Faq.tsx", "Figure.tsx"]) {
      const src = read(`src/components/marketing/${file}`);
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${file} has a raw hex color`);
      assert.ok(!/\bfetch\(/.test(src), `${file} calls fetch: the public page must not load tenant data`);
    }
    const css = read("src/components/marketing/landing.module.css").replace(/url\("data:[^"]*"\)/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), "landing.module.css has a raw color; use a token from tokens.css");
  });

  console.log(`\n  LANDING TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
