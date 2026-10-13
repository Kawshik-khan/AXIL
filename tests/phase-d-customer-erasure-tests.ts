/**
 * Phase D: Customer Erasure Transactional & Repository-Native Suite
 * Validates:
 * 1. Database-native customer erasure directly on PostgreSQL (commerceos schema).
 * 2. Order PII redaction (shipping/billing snapshots, notes) directly in commerceos.orders without in-memory diffing.
 * 3. Customer shell anonymization in commerceos.customers.
 * 4. Referential integrity & cascade deletion of addresses, identities, and dependent documents.
 * 5. Strict multi-tenant isolation.
 * 6. Atomic transaction rollback safety on unexpected error.
 * 7. Idempotency across repeated executions.
 *
 * Run: node tests/ts-runner.cjs ./tests/phase-d-customer-erasure-tests.ts
 */

import assert from "assert";
import { ZERO_HYDRATION_CORE_TABLES, UNHYDRATED_DOCUMENT_COLLECTIONS } from "@/infrastructure/store/pg-store";
import { db } from "@/infrastructure/db";
import { runMigrations } from "@/infrastructure/store/migrations";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { orderRepository } from "@/domains/orders/order.repository";
import { customerRepository } from "@/domains/customers/customer.repository";
import { CustomerErasureService } from "@/domains/privacy/customer-erasure.service";
import { ROLE_PERMISSIONS, RoleName } from "@/lib/permissions";
import { RequestContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import type { Order, Customer } from "@/types/commerce";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(`      ${err instanceof Error ? err.stack || err.message : String(err)}`);
    failedCount++;
  }
}

const TENANT_A = "ten_phase_d_erasure_a";
const TENANT_B = "ten_phase_d_erasure_b";

function mockContext(tenantId: string, role: RoleName = "OWNER"): RequestContext {
  return {
    requestId: `req_${tenantId}`,
    traceId: `trace_${tenantId}`,
    timestamp: new Date().toISOString(),
    role,
    permissions: ROLE_PERMISSIONS[role] || [],
    tenant: {
      id: tenantId,
      name: `Workspace ${tenantId}`,
      slug: tenantId,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      settings: {},
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    user: {
      id: `usr_${tenantId}`,
      name: "Owner User",
      email: `owner@${tenantId}.com`,
      phone: "+8801700000000",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    membership: {
      id: `mem_${tenantId}`,
      tenant_id: tenantId,
      user_id: `usr_${tenantId}`,
      role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    stepUpVerified: true,
  } as RequestContext;
}

async function main() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  PHASE D: CUSTOMER ERASURE REPOSITORY-NATIVE & TRANSACTIONAL   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================${ANSI_RESET}\n`);

  const client: SqlClient = createPgliteClient();
  await runMigrations(client);
  (db as any).pg = { client };
  // The singleton now reads these tables from SQL, as it does with zero-hydration on in production
  (db as any).unhydratedCollections = new Set<string>([...ZERO_HYDRATION_CORE_TABLES, ...UNHYDRATED_DOCUMENT_COLLECTIONS]);

  // Seed tenants
  await client.query(
    `INSERT INTO commerceos.tenants (id, tenant_id, data) VALUES 
     ($1, $1, $3::jsonb),
     ($2, $2, $4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      TENANT_A,
      TENANT_B,
      JSON.stringify({ id: TENANT_A, name: "Shop A", slug: TENANT_A }),
      JSON.stringify({ id: TENANT_B, name: "Shop B", slug: TENANT_B }),
    ]
  );

  const CUST_A = "cust_erase_target_01";
  const CUST_B = "cust_erase_other_02";

  // Seed customer A in Tenant A
  await client.query(
    `INSERT INTO commerceos.customers (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
    [
      CUST_A,
      TENANT_A,
      JSON.stringify({
        id: CUST_A,
        tenant_id: TENANT_A,
        first_name: "Tariqul",
        last_name: "Islam",
        phone: "01712345678",
        email: "tariqul@example.com",
        notes: "Frequent buyer in Dhanmondi",
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ]
  );

  // Seed customer addresses
  await client.query(
    `INSERT INTO commerceos.customer_addresses (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
    [
      `addr_${CUST_A}`,
      TENANT_A,
      JSON.stringify({
        id: `addr_${CUST_A}`,
        tenant_id: TENANT_A,
        customer_id: CUST_A,
        address_line_1: "House 45, Road 7A, Dhanmondi",
        district: "Dhaka",
        phone: "01712345678",
      }),
    ]
  );

  // Seed customer identities
  await client.query(
    `INSERT INTO commerceos.customer_identities (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
    [
      `idn_${CUST_A}`,
      TENANT_A,
      JSON.stringify({
        id: `idn_${CUST_A}`,
        tenant_id: TENANT_A,
        customer_id: CUST_A,
        channel_type: "WHATSAPP",
        external_user_id: "01712345678",
        display_name: "Tariqul Islam",
      }),
    ]
  );

  // Seed customer B in Tenant B (Isolation guard)
  await client.query(
    `INSERT INTO commerceos.customers (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
    [
      CUST_B,
      TENANT_B,
      JSON.stringify({
        id: CUST_B,
        tenant_id: TENANT_B,
        first_name: "Tariqul",
        last_name: "Islam",
        phone: "01712345678",
        email: "tariqul@other.com",
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ]
  );

  // Seed Orders for Customer A in Tenant A
  const ORDER_A1 = "ord_erase_a1";
  const ORDER_A2 = "ord_erase_a2";
  await client.query(
    `INSERT INTO commerceos.orders (id, tenant_id, data) VALUES 
     ($1, $3, $4::jsonb),
     ($2, $3, $5::jsonb)`,
    [
      ORDER_A1,
      ORDER_A2,
      TENANT_A,
      JSON.stringify({
        id: ORDER_A1,
        tenant_id: TENANT_A,
        order_number: "ORD-ERASE-101",
        customer_id: CUST_A,
        status: "DELIVERED",
        grand_total: 2500,
        subtotal: 2400,
        shipping_total: 100,
        notes: "Deliver after 5pm to Tariqul Islam at Dhanmondi House 45",
        shipping_address_snapshot: {
          name: "Tariqul Islam",
          phone: "01712345678",
          address_line_1: "House 45, Road 7A",
          area: "Dhanmondi",
          district: "Dhaka",
          division: "Dhaka",
          country: "Bangladesh",
        },
        billing_address_snapshot: {
          name: "Tariqul Islam",
          phone: "01712345678",
          address_line_1: "House 45, Road 7A",
          area: "Dhanmondi",
          district: "Dhaka",
          division: "Dhaka",
          country: "Bangladesh",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      JSON.stringify({
        id: ORDER_A2,
        tenant_id: TENANT_A,
        order_number: "ORD-ERASE-102",
        customer_id: CUST_A,
        status: "CONFIRMED",
        grand_total: 1200,
        subtotal: 1100,
        shipping_total: 100,
        notes: "Call 01712345678 on arrival",
        shipping_address_snapshot: {
          name: "Tariqul Islam",
          phone: "01712345678",
          address_line_1: "House 45, Road 7A",
          area: "Dhanmondi",
          district: "Dhaka",
          division: "Dhaka",
          country: "Bangladesh",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ]
  );

  // Seed Order for Customer B in Tenant B
  const ORDER_B1 = "ord_erase_b1";
  await client.query(
    `INSERT INTO commerceos.orders (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
    [
      ORDER_B1,
      TENANT_B,
      JSON.stringify({
        id: ORDER_B1,
        tenant_id: TENANT_B,
        order_number: "ORD-ERASE-B1",
        customer_id: CUST_B,
        status: "PROCESSING",
        grand_total: 3500,
        notes: "Do not erase this tenant B order",
        shipping_address_snapshot: {
          name: "Tariqul Islam",
          phone: "01712345678",
          district: "Dhaka",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ]
  );

  // Seed dependent document for Customer A
  await client.query(
    `INSERT INTO commerceos.documents (collection, id, tenant_id, data) VALUES ($1, $2, $3, $4::jsonb)`,
    [
      "customer_memories",
      `mem_${CUST_A}`,
      TENANT_A,
      JSON.stringify({
        id: `mem_${CUST_A}`,
        tenant_id: TENANT_A,
        customer_id: CUST_A,
        memory_text: "Prefers cotton shirts and lives in Dhanmondi",
      }),
    ]
  );

  console.log("--- 1. Database-Native Customer Erasure Execution ---");

  await runTest("CustomerErasureService.erase executes atomic erasure in PostgreSQL", async () => {
    const ctx = mockContext(TENANT_A);
    const result = await CustomerErasureService.erase(ctx, CUST_A, "User requested GDPR erasure");

    assert.strictEqual(result.customer_id, CUST_A);
    assert.strictEqual(result.orders_redacted, 2);
    assert.strictEqual(result.deleted["customer_addresses"], 1);
    assert.strictEqual(result.deleted["customer_identities"], 1);
    assert.strictEqual(result.deleted["customer_memories"], 1);
  });

  console.log("\n--- 2. Order PII Redaction Integrity in Database ---");

  await runTest("Orders retain totals, items, and status but have all customer PII redacted in database", async () => {
    const resA1 = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.orders WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, ORDER_A1]
    );
    const o1 = typeof resA1.rows[0].data === "string" ? JSON.parse(resA1.rows[0].data) : resA1.rows[0].data;

    assert.strictEqual(o1.grand_total, 2500, "Grand total intact");
    assert.strictEqual(o1.status, "DELIVERED", "Order status preserved");
    assert.strictEqual(o1.notes, undefined, "Order notes removed");

    // Shipping snapshot retains district/division/area/country, strips name, phone, street lines
    assert.deepStrictEqual(o1.shipping_address_snapshot, {
      area: "Dhanmondi",
      district: "Dhaka",
      division: "Dhaka",
      country: "Bangladesh",
    });

    // Billing snapshot sanitized
    assert.deepStrictEqual(o1.billing_address_snapshot, {
      area: "Dhanmondi",
      district: "Dhaka",
      division: "Dhaka",
      country: "Bangladesh",
    });

    // Check order 2
    const resA2 = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.orders WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, ORDER_A2]
    );
    const o2 = typeof resA2.rows[0].data === "string" ? JSON.parse(resA2.rows[0].data) : resA2.rows[0].data;
    assert.strictEqual(o2.grand_total, 1200);
    assert.strictEqual(o2.status, "CONFIRMED");
    assert.strictEqual(o2.notes, undefined);
  });

  console.log("\n--- 3. Customer Shell & Dependent Records Anonymization ---");

  await runTest("Customer shell in PostgreSQL is anonymized and dependent records are deleted", async () => {
    const custRes = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, CUST_A]
    );
    const cust = typeof custRes.rows[0].data === "string" ? JSON.parse(custRes.rows[0].data) : custRes.rows[0].data;

    assert.strictEqual(cust.first_name, "Erased");
    assert.strictEqual(cust.last_name, "customer");
    assert.strictEqual(cust.phone, "");
    assert.strictEqual(cust.email, undefined);
    assert.strictEqual(cust.notes, undefined);

    // Addresses & identities deleted from tables
    const addrRes = await client.query(
      `SELECT id FROM commerceos.customer_addresses WHERE tenant_id = $1 AND customer_id = $2`,
      [TENANT_A, CUST_A]
    );
    assert.strictEqual(addrRes.rowCount, 0, "Addresses deleted");

    const idnRes = await client.query(
      `SELECT id FROM commerceos.customer_identities WHERE tenant_id = $1 AND customer_id = $2`,
      [TENANT_A, CUST_A]
    );
    assert.strictEqual(idnRes.rowCount, 0, "Identities deleted");

    // Dependent memory documents deleted
    const docRes = await client.query(
      `SELECT id FROM commerceos.documents WHERE tenant_id = $1 AND collection = 'customer_memories' AND data->>'customer_id' = $2`,
      [TENANT_A, CUST_A]
    );
    assert.strictEqual(docRes.rowCount, 0, "Customer memory documents deleted");
  });

  console.log("\n--- 4. Audit Trail & Tenant Isolation Invariants ---");

  await runTest("Audit log entry created transactionally in commerceos.audit_logs", async () => {
    const auditRes = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.audit_logs WHERE tenant_id = $1 AND resource_id = $2 AND action = 'CUSTOMER_ERASED'`,
      [TENANT_A, CUST_A]
    );
    assert.strictEqual(auditRes.rowCount, 1, "Audit log exists in PostgreSQL");
    const log = typeof auditRes.rows[0].data === "string" ? JSON.parse(auditRes.rows[0].data) : auditRes.rows[0].data;
    assert.strictEqual(log.resource_type, "customer");
    assert.strictEqual(log.metadata.reason, "User requested GDPR erasure");
    assert.strictEqual(log.metadata.orders_redacted, 2);
  });

  await runTest("Strict Tenant Isolation: Tenant B customer and orders remain 100% untouched", async () => {
    const custResB = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = $2`,
      [TENANT_B, CUST_B]
    );
    const custB = typeof custResB.rows[0].data === "string" ? JSON.parse(custResB.rows[0].data) : custResB.rows[0].data;
    assert.strictEqual(custB.first_name, "Tariqul", "Tenant B first name untouched");
    assert.strictEqual(custB.phone, "01712345678", "Tenant B phone untouched");

    const orderResB = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.orders WHERE tenant_id = $1 AND id = $2`,
      [TENANT_B, ORDER_B1]
    );
    const ordB = typeof orderResB.rows[0].data === "string" ? JSON.parse(orderResB.rows[0].data) : orderResB.rows[0].data;
    assert.strictEqual(ordB.notes, "Do not erase this tenant B order");
    assert.strictEqual((ordB.shipping_address_snapshot as any).name, "Tariqul Islam");
  });

  await runTest("Cross-tenant erasure attempt throws NotFoundError", async () => {
    const ctxB = mockContext(TENANT_B);
    await assert.rejects(
      async () => CustomerErasureService.erase(ctxB, CUST_A, "Cross tenant attack"),
      NotFoundError
    );
  });

  console.log("\n--- 5. Transaction Rollback Safety ---");

  await runTest("Simulated transaction failure triggers clean rollback without partial erasure", async () => {
    const CUST_FAIL = "cust_fail_rollback_test";
    await client.query(
      `INSERT INTO commerceos.customers (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
      [
        CUST_FAIL,
        TENANT_A,
        JSON.stringify({
          id: CUST_FAIL,
          tenant_id: TENANT_A,
          first_name: "Rollback",
          last_name: "Test",
          phone: "01999999999",
          status: "ACTIVE",
        }),
      ]
    );

    // Run custom failing transaction
    await assert.rejects(async () => {
      await client.transaction(async (tx) => {
        // Redact customer
        await customerRepository.anonymize(TENANT_A, CUST_FAIL, tx);
        // Deliberate error before commit
        throw new Error("Simulated database failure during customer erasure");
      });
    }, /Simulated database failure/);

    // Verify row was NOT erased (rolled back completely)
    const checkRes = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.customers WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, CUST_FAIL]
    );
    const row = typeof checkRes.rows[0].data === "string" ? JSON.parse(checkRes.rows[0].data) : checkRes.rows[0].data;
    assert.strictEqual(row.first_name, "Rollback", "Customer not erased due to rollback");
    assert.strictEqual(row.phone, "01999999999", "Customer phone retained due to rollback");
  });

  console.log("\n--- 6. Idempotency Invariant ---");

  await runTest("Re-erasing an already erased customer succeeds cleanly and remains idempotent", async () => {
    const ctx = mockContext(TENANT_A);
    const result = await CustomerErasureService.erase(ctx, CUST_A, "Second erasure invocation");
    assert.strictEqual(result.customer_id, CUST_A);
    assert.strictEqual(result.orders_redacted, 2);
  });

  console.log(`\n================================================================`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`================================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
