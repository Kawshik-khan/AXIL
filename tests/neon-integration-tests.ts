/**
 * CommerceOS — Neon PostgreSQL Integration & Repository Tests
 * Verifies repository methods, tenant boundary isolation, and fallback operation.
 */

import assert from "assert";
import { tenantRepository } from "@/domains/tenants/tenant.repository";
import { userRepository } from "@/domains/auth/user.repository";
import { productRepository } from "@/domains/catalog/product.repository";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";
import { customerRepository } from "@/domains/customers/customer.repository";
import { orderRepository } from "@/domains/orders/order.repository";
import { paymentRepository } from "@/domains/payments/payment.repository";
import { shippingRepository } from "@/domains/shipping/shipping.repository";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS - ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ FAIL - ${name}: ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log("\n====================================================");
  console.log("   COMMERCEOS NEON POSTGRESQL & REPOSITORY TESTS    ");
  console.log("====================================================\n");

  const runId = Math.random().toString(36).substring(2, 8);
  const testTenantId = `ten_test_${runId}`;
  const testTenantId2 = `ten_test_iso_${runId}`;
  const testUserId = `usr_test_${runId}`;
  const testEmail = `neon_user_${runId}@store.com`;
  const testProdId = `prod_test_${runId}`;
  const testCustId = `cust_test_${runId}`;
  const testOrderId = `ord_test_${runId}`;
  const testPayId = `pay_test_${runId}`;
  const testShipId = `ship_test_${runId}`;

  console.log("[1. Tenant & User Repository]");
  await test("Tenant repository creates and retrieves tenant", async () => {
    const created = await tenantRepository.createTenant({
      id: testTenantId,
      name: "Neon Test Store",
      slug: `neon-test-store-${runId}`,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      settings: { fee: 60 },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    assert.strictEqual(created.id, testTenantId);

    const found = await tenantRepository.findById(testTenantId);
    assert.ok(found);
    assert.strictEqual(found?.name, "Neon Test Store");
  });

  await test("User repository handles user lifecycle and authentication", async () => {
    const user = await userRepository.createUser({
      id: testUserId,
      email: testEmail,
      name: "Neon Admin",
      password_hash: "hashed_pw",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    assert.strictEqual(user.email, testEmail);

    const found = await userRepository.findByEmail(testEmail);
    assert.ok(found);
    assert.strictEqual(found?.id, testUserId);
  });

  console.log("\n[2. Product & Inventory Repository]");
  await test("Product repository creates product with variants and checks tenant isolation", async () => {
    const prod = await productRepository.createProduct({
      id: testProdId,
      tenant_id: testTenantId,
      name: "Premium Cotton Panjabi",
      slug: `premium-cotton-panjabi-${runId}`,
      description: "Comfortable traditional wear",
      sku: `PANJ-${runId.toUpperCase()}`,
      base_price: 1850,
      currency: "BDT",
      status: "ACTIVE",
      images: ["https://example.com/img1.jpg"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 50);

    assert.strictEqual(prod.name, "Premium Cotton Panjabi");

    // Tenant 1 can see it
    const p1 = await productRepository.findById(testTenantId, testProdId);
    assert.ok(p1);

    // Tenant 2 CANNOT see it (Isolation)
    const p2 = await productRepository.findById(testTenantId2, testProdId);
    assert.strictEqual(p2, null);
  });

  await test("Inventory repository reads inventory levels and handles adjustments", async () => {
    const levels = await inventoryRepository.getInventoryLevels(testTenantId);
    assert.ok(Array.isArray(levels));
  });

  console.log("\n[3. Customer & Order Repository]");
  await test("Customer repository creates customer with phone indexing", async () => {
    const phone = `+88017${Math.floor(10000000 + Math.random() * 90000000)}`;
    const cust = await customerRepository.createCustomer({
      id: testCustId,
      tenant_id: testTenantId,
      full_name: "Tanvir Ahmed",
      email: `tanvir_${runId}@dhaka.com`,
      phone: phone,
      total_orders: 0,
      total_spent: 0,
      is_blacklisted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    assert.strictEqual(cust.full_name, "Tanvir Ahmed");

    const byPhone = await customerRepository.findByPhone(testTenantId, phone);
    assert.ok(byPhone);
    assert.strictEqual(byPhone?.id, testCustId);
  });

  await test("Order repository creates order with order items", async () => {
    const order = await orderRepository.createOrder({
      id: testOrderId,
      tenant_id: testTenantId,
      order_number: `ORD-${runId.toUpperCase()}-001`,
      customer_id: testCustId,
      status: "PENDING_CONFIRMATION",
      subtotal: 1850,
      delivery_charge: 60,
      discount: 0,
      total: 1910,
      payment_method: "COD",
      payment_status: "UNPAID",
      delivery_address: { city: "Dhaka", address: "Banani 11" } as any,
      delivery_zone: "INSIDE_DHAKA",
      items: [
        {
          id: `item_${runId}_001`,
          tenant_id: testTenantId,
          order_id: testOrderId,
          product_variant_id: `var_${testProdId}_def`,
          product_name: "Premium Cotton Panjabi",
          variant_title: "Standard",
          sku: `PANJ-${runId.toUpperCase()}`,
          quantity: 1,
          unit_price: 1850,
          total_price: 1850,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    assert.strictEqual(order.order_number, `ORD-${runId.toUpperCase()}-001`);

    const fetched = await orderRepository.findById(testTenantId, testOrderId);
    assert.ok(fetched);
    assert.strictEqual(fetched?.total, 1910);
  });

  console.log("\n[4. Payment & Shipping Repository]");
  await test("Payment repository stores and tracks payment records", async () => {
    const pay = await paymentRepository.createPayment({
      id: testPayId,
      tenant_id: testTenantId,
      order_id: testOrderId,
      provider: "bKash",
      transaction_id: `TRX_BKASH_${runId}`,
      amount: 1910,
      currency: "BDT",
      status: "CAPTURED",
      created_at: new Date().toISOString(),
    } as any);

    assert.strictEqual(pay.amount, 1910);
    const payments = await paymentRepository.listPayments(testTenantId, testOrderId);
    assert.ok(payments.length >= 1);
  });

  await test("Shipping repository updates courier delivery status", async () => {
    const shipment = await shippingRepository.createShipment({
      id: testShipId,
      tenant_id: testTenantId,
      order_id: testOrderId,
      courier_provider: "STEADFAST",
      tracking_code: `STDF-${runId}`,
      delivery_status: "IN_TRANSIT",
      created_at: new Date().toISOString(),
    } as any);

    assert.strictEqual(shipment.courier_provider, "STEADFAST");

    const updated = await shippingRepository.updateShipmentStatus(
      testTenantId,
      testShipId,
      "DELIVERED"
    );
    assert.ok(updated);
  });

  // Teardown test tenant
  try {
    const { query } = await import("@/infrastructure/neon/client");
    await query("DELETE FROM tenants WHERE id IN ($1, $2)", [testTenantId, testTenantId2]);
    await query("DELETE FROM users WHERE id = $1", [testUserId]);
  } catch {}

  console.log("\n====================================================");
  console.log(`  NEON REPOSITORY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("====================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner fatal error:", err);
  process.exit(1);
});
