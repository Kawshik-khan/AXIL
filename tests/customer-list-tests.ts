/**
 * The Customers page list: segments (from each customer's order counters), the segment chip counts, sorts, the chat
 * channels on each row, and the route's validation. Every case runs on the in-memory store and again on Postgres
 * (in-memory PGlite, the SQL the repository runs under zero-hydration), and both must return the same rows in the
 * same order.
 */
import assert from "assert";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { CustomerService } from "@/domains/customers/customer.service";
import { runMigrations } from "@/infrastructure/store/migrations";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import { ZERO_HYDRATION_CORE_TABLES, UNHYDRATED_DOCUMENT_COLLECTIONS } from "@/infrastructure/store/pg-store";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import {
  CUSTOMER_SEGMENTS,
  CUSTOMER_SORTS,
  HIGH_VALUE_LIFETIME_SPEND_BDT,
  customerSegment,
  type CustomerSegment,
  type CustomerSort,
} from "@/lib/customer-segments";
import { PERMISSIONS } from "@/lib/permissions";
import type { RequestContext } from "@/lib/context";
import type { Customer } from "@/types/commerce";
import type { CustomerIdentity } from "@/types/social";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(err);
    failed++;
  }
}

const TENANT = "ten_customer_list_a";
const OTHER = "ten_customer_list_b";
const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

type Seed = { key: string; first: string; last: string; orders?: number; spent?: number; createdDaysAgo: number; lastOrderDaysAgo?: number };

const SEEDS: Seed[] = [
  { key: "n1", first: "Imran", last: "Hossain", orders: 0, spent: 0, createdDaysAgo: 1 },
  { key: "n2", first: "Sumaiya", last: "Islam", orders: 0, spent: 0, createdDaysAgo: 8 },
  { key: "legacy", first: "Nusrat", last: "Jahan", createdDaysAgo: 5 }, // no counters at all: NEW
  { key: "o1", first: "Farhana", last: "Akter", orders: 1, spent: 1200, createdDaysAgo: 20, lastOrderDaysAgo: 3 },
  { key: "r1", first: "Rakib", last: "Hasan", orders: 3, spent: 7930, createdDaysAgo: 30, lastOrderDaysAgo: 5 },
  { key: "r2", first: "Ayesha", last: "Siddika", orders: 2, spent: HIGH_VALUE_LIFETIME_SPEND_BDT - 1, createdDaysAgo: 40, lastOrderDaysAgo: 2 },
  { key: "h1", first: "Mahmudul", last: "Karim", orders: 1, spent: HIGH_VALUE_LIFETIME_SPEND_BDT, createdDaysAgo: 50, lastOrderDaysAgo: 10 },
  { key: "h2", first: "Tanvir", last: "Ahmed", orders: 14, spent: 62300, createdDaysAgo: 60, lastOrderDaysAgo: 0.5 },
];

const idOf = (key: string) => `cl_${key}`;

function customerRow(tenantId: string, s: Seed, id = idOf(s.key)): Customer {
  const created = ago(s.createdDaysAgo);
  const row: Record<string, unknown> = {
    id, tenant_id: tenantId, first_name: s.first, last_name: s.last, phone: `+8801711${String(SEEDS.indexOf(s)).padStart(6, "0")}`,
    status: "ACTIVE", source: "SOCIAL", created_at: created, updated_at: created,
  };
  if (s.orders !== undefined) row.total_orders = s.orders;
  if (s.spent !== undefined) row.total_spent = s.spent;
  if (s.lastOrderDaysAgo !== undefined) row.last_order_at = ago(s.lastOrderDaysAgo);
  return row as unknown as Customer;
}

function identityRow(tenantId: string, id: string, customerId: string, channel: CustomerIdentity["channel_type"]): CustomerIdentity {
  return {
    id, tenant_id: tenantId, customer_id: customerId, channel_id: `chn_${channel}`, channel_type: channel,
    external_user_id: `ext_${id}`, metadata: {}, first_seen_at: ago(30), last_seen_at: ago(1),
  };
}

const IDENTITIES: CustomerIdentity[] = [
  identityRow(TENANT, "ci_a1", idOf("r1"), "WHATSAPP"),
  identityRow(TENANT, "ci_a2", idOf("r1"), "FACEBOOK_MESSENGER"),
  identityRow(TENANT, "ci_a3", idOf("h2"), "INSTAGRAM"),
  // Another tenant's identity that names tenant A's customer id must never show on tenant A's row
  identityRow(OTHER, "ci_b1", idOf("r1"), "TELEGRAM"),
];
const OTHER_CUSTOMER = customerRow(OTHER, { key: "b", first: "Other", last: "Shop", orders: 9, spent: 99_000, createdDaysAgo: 0 }, "cl_other_b");

function ctx(tenantId: string): RequestContext {
  return {
    requestId: "req_customer_list", traceId: "trc_customer_list",
    user: { id: "usr_customer_list", email: "owner@customer-list.test", name: "Owner", status: "ACTIVE" },
    tenant: { id: tenantId, name: "Customer List Shop", slug: "customer-list", currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER", permissions: Object.values(PERMISSIONS), timestamp: new Date().toISOString(),
  } as RequestContext;
}

/** Expected orders, worked out by hand from SEEDS (the same list on both backends). */
const EXPECTED_ORDER: Record<CustomerSort, string[]> = {
  newest: ["n1", "legacy", "n2", "o1", "r1", "r2", "h1", "h2"],
  lifetime_value: ["h2", "h1", "r2", "r1", "o1", "n1", "legacy", "n2"],
  orders: ["h2", "r1", "r2", "o1", "h1", "n1", "legacy", "n2"],
  last_order: ["h2", "r2", "o1", "r1", "h1", "n1", "legacy", "n2"],
  name: ["r2", "o1", "n1", "h1", "legacy", "r1", "n2", "h2"],
};
const EXPECTED_SEGMENTS: Record<CustomerSegment, string[]> = {
  NEW: ["n1", "legacy", "n2"],
  ONE_TIME: ["o1"],
  REPEAT: ["r1", "r2"],
  HIGH_VALUE: ["h1", "h2"],
};
const keys = (list: Array<{ id: string }>) => list.map((c) => c.id.replace(/^cl_/, ""));

/** Runs every list case on whichever backend the store currently uses; returns each case's ids for the parity check. */
async function listCases(label: string): Promise<Record<string, string[]>> {
  const seen: Record<string, string[]> = {};
  const context = ctx(TENANT);

  await runTest(`${label}: segment counts cover the tenant's customers only`, async () => {
    const page = await CustomerService.listCustomers(context, { limit: 50 });
    assert.deepStrictEqual(page.segment_counts, { NEW: 3, ONE_TIME: 1, REPEAT: 2, HIGH_VALUE: 2 });
    assert.strictEqual(page.total, SEEDS.length);
    assert.ok(page.customers.every((c) => c.tenant_id === TENANT));
  });

  for (const sort of CUSTOMER_SORTS) {
    await runTest(`${label}: sort "${sort}" returns the expected order`, async () => {
      const page = await CustomerService.listCustomers(context, { limit: 50, sort });
      assert.deepStrictEqual(keys(page.customers), EXPECTED_ORDER[sort]);
      seen[`sort:${sort}`] = keys(page.customers);
    });
  }

  for (const segment of CUSTOMER_SEGMENTS) {
    await runTest(`${label}: segment ${segment} returns its customers, total and unchanged chip counts`, async () => {
      const page = await CustomerService.listCustomers(context, { limit: 50, segment });
      assert.deepStrictEqual(keys(page.customers), EXPECTED_SEGMENTS[segment]);
      assert.strictEqual(page.total, EXPECTED_SEGMENTS[segment].length);
      assert.ok(page.customers.every((c) => c.segment === segment));
      assert.deepStrictEqual(page.segment_counts, { NEW: 3, ONE_TIME: 1, REPEAT: 2, HIGH_VALUE: 2 });
      seen[`segment:${segment}`] = keys(page.customers);
    });
  }

  await runTest(`${label}: thresholds are inclusive (৳25,000 with one order is high value; ৳24,999 with two is repeat)`, async () => {
    const page = await CustomerService.listCustomers(context, { limit: 50 });
    const byKey = new Map(page.customers.map((c) => [c.id.replace(/^cl_/, ""), c.segment]));
    assert.strictEqual(byKey.get("h1"), "HIGH_VALUE");
    assert.strictEqual(byKey.get("r2"), "REPEAT");
    assert.strictEqual(byKey.get("legacy"), "NEW");
  });

  await runTest(`${label}: search and segment combine; counts follow the search`, async () => {
    const page = await CustomerService.listCustomers(context, { limit: 50, search: "a", segment: "HIGH_VALUE", sort: "name" });
    // Every seeded name holds an "a"; the search keeps all eight, the segment keeps two
    assert.deepStrictEqual(keys(page.customers), ["h1", "h2"]);
    const narrow = await CustomerService.listCustomers(context, { limit: 50, search: "rakib" });
    assert.deepStrictEqual(narrow.segment_counts, { NEW: 0, ONE_TIME: 0, REPEAT: 1, HIGH_VALUE: 0 });
    assert.deepStrictEqual(keys(narrow.customers), ["r1"]);
  });

  await runTest(`${label}: a filtered, sorted list pages without overlap`, async () => {
    const first = await CustomerService.listCustomers(context, { limit: 2, offset: 0, segment: "NEW", sort: "lifetime_value" });
    const second = await CustomerService.listCustomers(context, { limit: 2, offset: 2, segment: "NEW", sort: "lifetime_value" });
    assert.deepStrictEqual([...keys(first.customers), ...keys(second.customers)], ["n1", "legacy", "n2"]);
    assert.strictEqual(first.total, 3);
    seen.paged = [...keys(first.customers), ...keys(second.customers)];
  });

  await runTest(`${label}: each row carries its own tenant's chat channels`, async () => {
    const page = await CustomerService.listCustomers(context, { limit: 50 });
    const byKey = new Map(page.customers.map((c) => [c.id.replace(/^cl_/, ""), c.channels]));
    assert.deepStrictEqual(byKey.get("r1"), ["FACEBOOK_MESSENGER", "WHATSAPP"]);
    assert.deepStrictEqual(byKey.get("h2"), ["INSTAGRAM"]);
    assert.deepStrictEqual(byKey.get("n1"), []);
  });

  await runTest(`${label}: the other tenant sees only its own customer`, async () => {
    const page = await CustomerService.listCustomers(ctx(OTHER), { limit: 50 });
    assert.deepStrictEqual(page.customers.map((c) => c.id), ["cl_other_b"]);
    assert.deepStrictEqual(page.segment_counts, { NEW: 0, ONE_TIME: 0, REPEAT: 0, HIGH_VALUE: 1 });
    assert.deepStrictEqual(page.customers[0].channels, [], "tenant A's identities never attach to tenant B");
  });

  await runTest(`${label}: a cursor page refuses a segment or sort instead of ignoring it`, async () => {
    await assert.rejects(() => CustomerService.listCustomers(context, { cursor: "", segment: "NEW" }), /offset pages/);
  });

  return seen;
}

async function seedPostgres(client: SqlClient): Promise<void> {
  const insertCustomer = (c: Customer) =>
    client.query(
      `INSERT INTO commerceos.customers (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [c.id, c.tenant_id, c.created_at, JSON.stringify(c)]
    );
  for (const s of SEEDS) await insertCustomer(customerRow(TENANT, s));
  await insertCustomer(OTHER_CUSTOMER);
  for (const identity of IDENTITIES) {
    await client.query(
      `INSERT INTO commerceos.customer_identities (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [identity.id, identity.tenant_id, identity.first_seen_at, JSON.stringify(identity)]
    );
  }
}

async function main() {
  console.log(`\n${BOLD}====================================================${RESET}`);
  console.log(`${BOLD}   CUSTOMERS PAGE: SEGMENTS, SORTS AND CHANNELS      ${RESET}`);
  console.log(`${BOLD}====================================================\n${RESET}`);

  await runTest("customerSegment: counters decide the segment; missing counters are a new customer", () => {
    assert.strictEqual(customerSegment({}), "NEW");
    assert.strictEqual(customerSegment({ total_orders: 0, total_spent: 50_000 }), "NEW");
    assert.strictEqual(customerSegment({ total_orders: 1, total_spent: 500 }), "ONE_TIME");
    assert.strictEqual(customerSegment({ total_orders: 2, total_spent: 500 }), "REPEAT");
    assert.strictEqual(customerSegment({ total_orders: 1, total_spent: HIGH_VALUE_LIFETIME_SPEND_BDT }), "HIGH_VALUE");
  });

  console.log("\n--- In-memory store ---");
  db.clearAllForTesting();
  for (const s of SEEDS) db.data.customers.push(customerRow(TENANT, s));
  db.data.customers.push(OTHER_CUSTOMER);
  for (const identity of IDENTITIES) db.data.customer_identities.push(identity);
  const memory = await listCases("memory");

  console.log("\n--- GET /api/v1/customers ---");
  const password = `List-${crypto.randomUUID()}-Aa1!`;
  const shop = await AuthService.registerTenantWithOwner({
    email: `owner_${crypto.randomUUID().slice(0, 8)}@customer-list.test`,
    password,
    name: "List Owner",
    workspaceName: "Customer List Route Shop",
  });
  db.data.customers.push(customerRow(shop.tenant.id, SEEDS[7], "cl_route_h2"));
  const token = (await AuthService.login(shop.user.email, password, shop.tenant.id)).token;
  const { GET } = (await import("@/app/api/v1/customers/route")) as { GET: (r: Request) => Promise<Response> };
  const call = (query: string) =>
    GET(new NextRequest(`http://localhost:3000/api/v1/customers${query}`, { headers: { authorization: `Bearer ${token}` } }));

  await runTest("route: a segment and sort come back with the rows and the chip counts in meta", async () => {
    const res = await call("?segment=HIGH_VALUE&sort=lifetime_value");
    const json = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(json));
    assert.deepStrictEqual(json.data.map((c: Customer) => c.id), ["cl_route_h2"]);
    assert.strictEqual(json.data[0].segment, "HIGH_VALUE");
    assert.deepStrictEqual(json.meta.segment_counts, { NEW: 0, ONE_TIME: 0, REPEAT: 0, HIGH_VALUE: 1 });
    assert.strictEqual(json.meta.total, 1);
  });

  await runTest("route: an unknown segment or sort is a 400, never a silent full list", async () => {
    assert.strictEqual((await call("?segment=VIP")).status, 400);
    assert.strictEqual((await call("?sort=total_spent;drop")).status, 400);
  });

  console.log("\n--- Postgres (PGlite, zero-hydration SQL) ---");
  const client = createPgliteClient();
  await runMigrations(client);
  await seedPostgres(client);
  const store = db as unknown as { pg: unknown; unhydratedCollections: Set<string> };
  const saved = { pg: store.pg, unhydrated: store.unhydratedCollections };
  store.pg = { client };
  store.unhydratedCollections = new Set<string>([...ZERO_HYDRATION_CORE_TABLES, ...UNHYDRATED_DOCUMENT_COLLECTIONS]);
  try {
    await runTest("the customers and identities really are read from Postgres", () => {
      assert.strictEqual(db.isCollectionHydrated("customers"), false);
      assert.strictEqual(db.isCollectionHydrated("customer_identities"), false);
    });
    const sql = await listCases("postgres");
    await runTest("memory and Postgres return the same rows in the same order for every case", () => {
      assert.deepStrictEqual(sql, memory);
    });
  } finally {
    store.pg = saved.pg;
    store.unhydratedCollections = saved.unhydrated;
  }

  console.log(`\n${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${failed ? RED : GREEN}${failed} failed${RESET}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
