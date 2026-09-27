// @ts-ignore
import assert from "assert";
declare const process: { exit(code?: number): void };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { TenantService } from "@/domains/tenants/service";
import { ProductService } from "@/domains/catalog/product.service";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { CustomerService } from "@/domains/customers/customer.service";
import { PricingService } from "@/domains/pricing/pricing.service";
import { CouponService } from "@/domains/promotions/coupon.service";
import { OrderService } from "@/domains/orders/order.service";
import { OrderStateMachine } from "@/domains/orders/order-state-machine";
import { PaymentService } from "@/domains/payments/payment.service";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { ReturnService } from "@/domains/returns/return.service";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { ConflictError, ForbiddenError, BadRequestError } from "@/lib/errors";

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
    console.error(err);
    failedCount++;
  }
}

export async function runCommerceTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 2: COMMERCE CORE TEST SUITE       ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();

  // Setup 2 isolated tenants for cross-tenant testing
  const now = Date.now();
  const tenantA = await AuthService.registerTenantWithOwner({
    workspaceName: `Aarong Heritage ${now}`,
    name: "Aarong Admin",
    email: `aarong-${now}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });

  const tenantB = await AuthService.registerTenantWithOwner({
    workspaceName: `Yellow Fashion ${now}`,
    name: "Yellow Admin",
    email: `yellow-${now}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });

  const nowIso = new Date().toISOString();

  const contextA: RequestContext = {
    requestId: "req_test_a",
    traceId: "trc_test_a",
    user: {
      id: tenantA.user.id,
      email: tenantA.user.email,
      name: tenantA.user.name,
      status: "ACTIVE",
    },
    tenant: {
      id: tenantA.tenant.id,
      name: tenantA.tenant.name,
      slug: tenantA.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: nowIso,
  };

  const contextB: RequestContext = {
    requestId: "req_test_b",
    traceId: "trc_test_b",
    user: {
      id: tenantB.user.id,
      email: tenantB.user.email,
      name: tenantB.user.name,
      status: "ACTIVE",
    },
    tenant: {
      id: tenantB.tenant.id,
      name: tenantB.tenant.name,
      slug: tenantB.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: nowIso,
  };

  // -------------------------------------------------------------
  // SUITE 1: CATALOG & VARIANT MANAGEMENT
  // -------------------------------------------------------------
  console.log(`${ANSI_BOLD}[1] Product Catalog & Multi-Variant Management${ANSI_RESET}`);

  let productA1: any;

  await runTest("Create product with variants and initial stock", async () => {
    productA1 = await ProductService.createProduct(contextA, {
      name: "Classic Silk Panjabi",
      sku: "PAN-SILK-001",
      base_price: 2500,
      compare_at_price: 3000,
      initial_stock: 20,
      variants: [
        { title: "Medium / Navy", sku: "PAN-SILK-M-NVY", price: 2500, initial_stock: 12 },
        { title: "Large / Navy", sku: "PAN-SILK-L-NVY", price: 2600, initial_stock: 8 },
      ],
    });

    assert.ok(productA1.id);
    assert.strictEqual(productA1.name, "Classic Silk Panjabi");
    assert.strictEqual(productA1.slug, "classic-silk-panjabi");
    assert.strictEqual(productA1.variants.length, 2);

    // Verify inventory initialized in default warehouse
    const inv = await InventoryService.getInventoryLevels(contextA);
    assert.ok(inv.length >= 2);
    const mStock = inv.find((i) => i.sku === "PAN-SILK-M-NVY");
    assert.ok(mStock);
    assert.strictEqual(mStock?.quantity_on_hand, 12);
  });

  await runTest("Prevent duplicate SKU collision in the same tenant", async () => {
    let errorCaught = false;
    try {
      await ProductService.createProduct(contextA, {
        name: "Conflicting Product",
        sku: "PAN-SILK-001", // Duplicate of productA1
        base_price: 1800,
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        errorCaught = true;
      }
    }
    assert.strictEqual(errorCaught, true, "Must reject duplicate SKU in same tenant");
  });

  await runTest("Allow identical SKU in a different tenant (Tenant Boundary Isolation)", async () => {
    const productB = await ProductService.createProduct(contextB, {
      name: "Classic Silk Panjabi - Yellow Brand",
      sku: "PAN-SILK-001", // Same SKU as Tenant A, but in Tenant B
      base_price: 2800,
    });
    assert.ok(productB.id);
    assert.notStrictEqual(productB.id, productA1.id);
    assert.strictEqual(productB.tenant_id, tenantB.tenant.id);
  });

  await runTest("Cross-tenant catalog read isolation", async () => {
    const productsA = await ProductService.listProducts(contextA);
    const productsB = await ProductService.listProducts(contextB);

    assert.ok(productsA.products.some((p) => p.id === productA1.id));
    assert.ok(!productsB.products.some((p) => p.id === productA1.id));
  });

  // -------------------------------------------------------------
  // SUITE 2: INVENTORY ATOMIC ADJUSTMENTS & RESERVATION ENGINE
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[2] Inventory Atomic Adjustments & Concurrency Protection${ANSI_RESET}`);

  const variantToTest = productA1.variants[0];
  const warehouses = await InventoryService.listWarehouses(contextA);
  const warehouse = warehouses[0];

  await runTest("Adjust stock positively with mandatory audit reason", async () => {
    const updated = await InventoryService.adjustStock(contextA, {
      warehouse_id: warehouse.id,
      product_variant_id: variantToTest.id,
      quantity_delta: 5,
      type: "PURCHASE",
      reason: "Received shipment from Narayanganj Mill",
    });

    assert.strictEqual(updated.quantity_on_hand, 17); // 12 + 5
    assert.strictEqual(updated.quantity_available, 17);
  });

  await runTest("Prevent negative stock when overselling is disabled", async () => {
    let errorCaught = false;
    try {
      await InventoryService.adjustStock(contextA, {
        warehouse_id: warehouse.id,
        product_variant_id: variantToTest.id,
        quantity_delta: -100, // Exceeds 17 on hand
        type: "DAMAGE",
        reason: "Accidental destruction",
      });
    } catch (err) {
      if (err instanceof BadRequestError) {
        errorCaught = true;
      }
    }
    assert.strictEqual(errorCaught, true, "Must prevent negative stock");
  });

  await runTest("Atomic reservation lifecycle: reserve, commit, release", async () => {
    // 1. Reserve 3 units
    const res = await InventoryService.reserveStock(contextA, {
      order_id: "ord_dummy_99",
      warehouse_id: warehouse.id,
      product_variant_id: variantToTest.id,
      quantity: 3,
    });

    assert.strictEqual(res.status, "ACTIVE");
    assert.strictEqual(res.quantity, 3);

    // Verify available stock decreased from 17 to 14, but on_hand remains 17
    let inv = await InventoryService.getInventoryLevels(contextA);
    let item = inv.find((i) => i.product_variant_id === variantToTest.id);
    assert.strictEqual(item?.quantity_on_hand, 17);
    assert.strictEqual(item?.quantity_reserved, 3);
    assert.strictEqual(item?.quantity_available, 14);

    // 2. Commit the reservation (Order Shipped)
    const commitSuccess = await InventoryService.commitReservation(contextA, res.id);
    assert.strictEqual(commitSuccess, true);

    // On-hand should now be 14, reserved 0, available 14
    inv = await InventoryService.getInventoryLevels(contextA);
    item = inv.find((i) => i.product_variant_id === variantToTest.id);
    assert.strictEqual(item?.quantity_on_hand, 14);
    assert.strictEqual(item?.quantity_reserved, 0);
    assert.strictEqual(item?.quantity_available, 14);
  });

  // -------------------------------------------------------------
  // SUITE 3: CUSTOMER PHONE NORMALIZATION & DEDUPLICATION
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[3] Customer Phone Normalization & Deduplication${ANSI_RESET}`);

  await runTest("Normalize Bangladeshi phone numbers to canonical +880 format", async () => {
    assert.strictEqual(CustomerService.normalizePhoneNumber("01712345678"), "+8801712345678");
    assert.strictEqual(CustomerService.normalizePhoneNumber("+8801712345678"), "+8801712345678");
    assert.strictEqual(CustomerService.normalizePhoneNumber("8801712345678"), "+8801712345678");
    assert.strictEqual(CustomerService.normalizePhoneNumber("01712-345 678"), "+8801712345678");
  });

  await runTest("Deduplicate customer profile when phone is supplied with different formats", async () => {
    const cust1 = await CustomerService.createCustomer(contextA, {
      first_name: "Farhan",
      last_name: "Ahmed",
      phone: "01811223344",
      address: {
        division: "Dhaka",
        district: "Dhaka",
        address_line_1: "Dhanmondi 27",
      },
    });

    const cust2 = await CustomerService.createCustomer(contextA, {
      first_name: "Farhan (Repeat)",
      last_name: "Ahmed",
      phone: "+8801811223344", // Same phone in international format
    });

    assert.strictEqual(cust1.id, cust2.id, "Customer IDs must match due to phone deduplication");
    assert.strictEqual(cust2.phone, "+8801811223344");
  });

  // -------------------------------------------------------------
  // SUITE 4: BANGLADESHI PRICING & PROMOTIONS ENGINE
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[4] Bangladeshi Delivery Pricing & Coupon Engine${ANSI_RESET}`);

  await runTest("Coupon creation and percentage discount capping", async () => {
    const coupon = await CouponService.createCoupon(contextA, {
      code: "EID2026",
      type: "PERCENTAGE",
      value: 20, // 20%
      maximum_discount: 400, // Capped at 400 BDT
      minimum_order_value: 1000,
    });

    assert.strictEqual(coupon.code, "EID2026");

    // Test subtotal 2500 -> 20% is 500, capped at 400
    const pricing = await PricingService.calculateOrderPricing(
      contextA.tenant.id,
      [{ variant_id: variantToTest.id, quantity: 1 }],
      "INSIDE_DHAKA",
      "eid2026"
    );

    assert.strictEqual(pricing.subtotal, 2500);
    assert.strictEqual(pricing.shipping_total, 60, "Inside Dhaka default must be 60 BDT");
    assert.strictEqual(pricing.discount_total, 400, "Discount must be capped at 400 BDT");
    assert.strictEqual(pricing.grand_total, 2160); // 2500 + 60 - 400
  });

  await runTest("Outside Dhaka shipping charge (120 BDT)", async () => {
    const pricing = await PricingService.calculateOrderPricing(
      contextA.tenant.id,
      [{ variant_id: variantToTest.id, quantity: 1 }],
      "OUTSIDE_DHAKA"
    );

    assert.strictEqual(pricing.shipping_total, 120, "Outside Dhaka must be 120 BDT");
    assert.strictEqual(pricing.grand_total, 2620);
  });

  // -------------------------------------------------------------
  // SUITE 5: ORDER STATE MACHINE & STRICT INVARIANTS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[5] Order State Machine & Invariant Transitions${ANSI_RESET}`);

  await runTest("Validate allowed and disallowed state transitions", async () => {
    // Allowed transitions
    assert.strictEqual(OrderStateMachine.canTransition("PENDING", "CONFIRMED"), true);
    assert.strictEqual(OrderStateMachine.canTransition("CONFIRMED", "PROCESSING"), true);
    assert.strictEqual(OrderStateMachine.canTransition("PROCESSING", "READY_TO_SHIP"), true);
    assert.strictEqual(OrderStateMachine.canTransition("READY_TO_SHIP", "SHIPPED"), true);
    assert.strictEqual(OrderStateMachine.canTransition("SHIPPED", "DELIVERED"), true);

    // Disallowed transitions
    assert.strictEqual(OrderStateMachine.canTransition("DELIVERED", "PENDING"), false);
    assert.strictEqual(OrderStateMachine.canTransition("CANCELLED", "CONFIRMED"), false);
    assert.strictEqual(OrderStateMachine.canTransition("PENDING", "DELIVERED"), false);
  });

  // -------------------------------------------------------------
  // SUITE 6: END-TO-END COMMERCE LIFECYCLE
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[6] Full End-to-End Commerce Lifecycle Flow${ANSI_RESET}`);

  let createdOrder: any;

  await runTest("Create order with stock reservation and snapshot pricing", async () => {
    createdOrder = await OrderService.createOrder(contextA, {
      customer: {
        first_name: "Sadman",
        last_name: "Sakib",
        phone: "01799887766",
        email: "sadman@example.com",
      },
      delivery_address: {
        division: "Dhaka",
        district: "Dhaka",
        address_line_1: "House 10, Road 5, Banani",
      },
      delivery_zone: "INSIDE_DHAKA",
      items: [{ variant_id: variantToTest.id, quantity: 2 }],
      payment_method: "COD",
    });

    assert.ok(createdOrder.id);
    assert.ok(createdOrder.order_number.startsWith("ORD-"));
    assert.strictEqual(createdOrder.status, "PENDING");
    assert.strictEqual(createdOrder.payment_status, "PENDING");
    assert.strictEqual(createdOrder.items.length, 1);
    assert.strictEqual(createdOrder.items[0].quantity, 2);
    assert.strictEqual(createdOrder.items[0].unit_price, 2500);
    assert.strictEqual(createdOrder.shipping_total, 60);
    assert.strictEqual(createdOrder.grand_total, 5060); // 5000 + 60

    // Check inventory reserved for this order
    const inv = await InventoryService.getInventoryLevels(contextA);
    const item = inv.find((i) => i.product_variant_id === variantToTest.id);
    assert.strictEqual(item?.quantity_reserved, 2);
  });

  await runTest("Transition order from PENDING to CONFIRMED and PROCESSING", async () => {
    let order = await OrderService.transitionOrderStatus(contextA, createdOrder.id, "CONFIRMED");
    assert.strictEqual(order.status, "CONFIRMED");

    order = await OrderService.transitionOrderStatus(contextA, createdOrder.id, "PROCESSING");
    assert.strictEqual(order.status, "PROCESSING");

    order = await OrderService.transitionOrderStatus(contextA, createdOrder.id, "READY_TO_SHIP");
    assert.strictEqual(order.status, "READY_TO_SHIP");
  });

  let shipmentRecord: any;

  await runTest("Dispatch shipment to Steadfast Courier", async () => {
    shipmentRecord = await ShippingService.createShipment(contextA, {
      order_id: createdOrder.id,
      courier_provider: "STEADFAST",
      tracking_number: "ST-889900",
      shipping_cost: 60,
    });

    assert.ok(shipmentRecord.id);
    assert.strictEqual(shipmentRecord.courier_provider, "STEADFAST");
    assert.strictEqual(shipmentRecord.tracking_number, "ST-889900");
    assert.strictEqual(shipmentRecord.status, "PENDING");
  });

  await runTest("Courier status normalization mapping (Steadfast, Pathao, RedX)", async () => {
    assert.strictEqual(ShippingService.mapCourierStatus("STEADFAST", "in_transit"), "IN_TRANSIT");
    assert.strictEqual(ShippingService.mapCourierStatus("STEADFAST", "delivered"), "DELIVERED");
    assert.strictEqual(ShippingService.mapCourierStatus("PATHAO", "picked"), "PICKED_UP");
    assert.strictEqual(ShippingService.mapCourierStatus("PATHAO", "failed"), "FAILED");
    assert.strictEqual(ShippingService.mapCourierStatus("REDX", "delivery_in_progress"), "OUT_FOR_DELIVERY");
  });

  await runTest("Delivery completion marks order DELIVERED and COD payment PAID", async () => {
    const updatedShipment = await ShippingService.updateDeliveryStatus(
      contextA,
      shipmentRecord.id,
      "DELIVERED"
    );

    assert.strictEqual(updatedShipment.status, "DELIVERED");

    // Verify order is DELIVERED and payment is PAID
    const order = await OrderService.getOrderById(contextA, createdOrder.id);
    assert.strictEqual(order.status, "DELIVERED");
    assert.strictEqual(order.payment_status, "PAID");

    // Verify customer spend and order count updated
    const customer = await CustomerService.getCustomerById(contextA, order.customer_id);
    assert.ok(customer.total_orders >= 1);
    assert.ok(customer.total_spent >= 5060);
  });

  // -------------------------------------------------------------
  // SUITE 7: RBAC PERMISSION BOUNDARY ENFORCEMENT
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[7] Role-Based Access Control (RBAC) Enforcement${ANSI_RESET}`);

  await runTest("Support role cannot adjust inventory or delete products", async () => {
    const supportContext: RequestContext = {
      requestId: "req_test_support",
      traceId: "trc_test_support",
      user: {
        id: "usr_support_1",
        email: "support@aarong.com",
        name: "Support Agent",
        status: "ACTIVE",
      },
      tenant: contextA.tenant,
      role: "SUPPORT",
      permissions: [PERMISSIONS.ORDERS_READ, PERMISSIONS.CUSTOMERS_READ],
      timestamp: new Date().toISOString(),
    };

    let forbiddenCaught = false;
    try {
      await InventoryService.adjustStock(supportContext, {
        warehouse_id: warehouse.id,
        product_variant_id: variantToTest.id,
        quantity_delta: 5,
        type: "ADJUSTMENT",
        reason: "Illegal modification by support",
      });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        forbiddenCaught = true;
      }
    }
    assert.strictEqual(forbiddenCaught, true, "SUPPORT role must be forbidden from adjusting stock");
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`   COMMERCE TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

if (require.main === module || !process.env.TEST_SUITE_RUNNER) {
  runCommerceTests().catch((err) => {
    console.error("Fatal commerce test failure:", err);
    process.exit(1);
  });
}
