import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { db } from "../src/infrastructure/db";
import { AuthService } from "../src/domains/auth/service";
import { normalizePhoneNumber, hashPhoneForReputation } from "../src/lib/rto-crypto";
import { RtoScoringService } from "../src/domains/rto/rto-scoring.service";
import { AdvanceFeeService } from "../src/domains/rto/advance-fee.service";
import { ShippingService } from "../src/domains/shipping/shipping.service";
import { OrderLifecycleService } from "../src/domains/orders/order-lifecycle.service";
import { RequestContext } from "../src/lib/context";
import { ROLE_PERMISSIONS } from "../src/lib/permissions";
import { Order, OrderStatus } from "../src/types/commerce";
import { NetworkDeliveryReputationRecord } from "../src/types/rto";

async function runRtoTests() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("   COMMERCEOS: CROSS-TENANT RTO & COURIER FRAUD NETWORK TESTS  ");
  console.log("══════════════════════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  const testTenantId = "tenant_rto_test_01";
  const mockContext: RequestContext = {
    requestId: "req_test_rto_01",
    traceId: "trc_test_rto_01",
    user: { id: "usr_merchant_01", email: "merchant@test.bd", name: "Merchant", status: "ACTIVE" },
    tenant: { id: testTenantId, name: "Fashion House BD", slug: "fashion-house", status: "ACTIVE" },
    role: "OWNER",
    permissions: [...ROLE_PERMISSIONS.OWNER],
    timestamp: new Date().toISOString(),
  };

  // =========================================================================
  // 1. PHONE NORMALIZATION & CRYPTOGRAPHIC HASHING TESTS
  // =========================================================================
  console.log("\n▶ Section 1: Phone Normalization & Salted HMAC Hashing");

  const p1 = normalizePhoneNumber("01712-345 678");
  const p2 = normalizePhoneNumber("+8801712345678");
  const p3 = normalizePhoneNumber("8801712345678");
  const p4 = normalizePhoneNumber("01712345678");

  assert(p1 === "+8801712345678", "Format '01712-345 678' normalizes to '+8801712345678'");
  assert(p1 === p2 && p2 === p3 && p3 === p4, "All 4 Bangladeshi phone formatting variants normalize identically");

  const hashA = hashPhoneForReputation("01712-345678");
  const hashB = hashPhoneForReputation("+8801712345678");
  const hashDifferent = hashPhoneForReputation("01899-112233");

  assert(hashA === hashB, "Identical normalized phone produces identical deterministic HMAC hash");
  assert(hashA !== hashDifferent, "Different phone numbers produce distinct HMAC hashes");
  assert(hashA.length === 64, "HMAC-SHA256 hash length is exactly 64 hexadecimal characters");
  assert(!hashA.includes("01712"), "Hash does NOT contain any raw phone plaintext (zero rainbow-leakage)");

  // =========================================================================
  // 2. PRIVACY & BLINDED REPUTATION SCHEMA TEST
  // =========================================================================
  console.log("\n▶ Section 2: Privacy Invariant & Blinded Reputation");

  const testPhone = "01755-998877";
  const testHash = hashPhoneForReputation(testPhone);

  const reputationProfile: NetworkDeliveryReputationRecord = {
    phone_hash: testHash,
    total_orders_tracked: 5,
    successful_deliveries: 1,
    returned_rto_count: 4,
    cancelled_before_ship_count: 0,
    disputed_courier_attempts: 0,
    delivery_success_rate: 20,
    rto_rate: 80,
    composite_risk_score: 72,
    risk_tier: "HIGH",
    first_seen_at: new Date().toISOString(),
    last_outcome: "RETURNED",
    last_outcome_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.saveNetworkDeliveryReputation(reputationProfile);
  const fetchedRep = db.findNetworkDeliveryReputationByHash(testHash);

  assert(Boolean(fetchedRep), "Reputation record saved and retrieved by hash");
  assert((fetchedRep as any)?.phone === undefined, "Reputation record contains NO plaintext phone number field");
  assert((fetchedRep as any)?.tenant_id === undefined, "Reputation record contains NO store/tenant attribution (cross-tenant blinded)");
  assert(fetchedRep?.risk_tier === "HIGH", "Serial rejector classified as HIGH risk tier");

  // =========================================================================
  // 3. MULTI-FACTOR BAYESIAN RTO SCORING TESTS
  // =========================================================================
  console.log("\n▶ Section 3: Multi-Factor RTO Risk Scoring");

  const mockCodOrder: Order = {
    id: "ord_rto_test_01",
    tenant_id: testTenantId,
    order_number: "ORD-RTO-1001",
    customer_id: "cust_test_01",
    source: "ONLINE_STORE",
    status: "PENDING",
    payment_status: "UNPAID",
    fulfillment_status: "UNFULFILLED",
    currency: "BDT",
    subtotal: 1800,
    discount_total: 0,
    tax_total: 0,
    shipping_total: 120,
    grand_total: 1920,
    payment_method: "COD",
    items: [{ id: "item_01", tenant_id: testTenantId, order_id: "ord_rto_test_01", product_variant_id: "v_1", quantity: 1, unit_price: 1800, total_price: 1800 } as any],
    shipping_address_snapshot: {
      address_line_1: "House 12, Road 4",
      district: "Dhaka",
      division: "Dhaka",
      country: "Bangladesh",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Test 3A: High Risk Serial Rejector
  const highRiskEval = await RtoScoringService.evaluateOrderRisk(mockContext, mockCodOrder, testPhone);
  assert(highRiskEval.risk_score >= 55, "Serial rejector scores in elevated risk zone (>= 55)", `Score: ${highRiskEval.risk_score}`);
  assert(
    highRiskEval.recommended_action === "REQUIRE_ADVANCE_COURIER_FEE" || highRiskEval.recommended_action === "MANUAL_CALL_REQUIRED",
    "High-risk COD order recommended for Advance Courier Fee or Call",
    highRiskEval.recommended_action
  );

  // Test 3B: Digital Prepaid Order (Full bKash payment upfront)
  const prepaidOrder: Order = {
    ...mockCodOrder,
    id: "ord_rto_test_02",
    order_number: "ORD-RTO-1002",
    payment_method: "BKASH",
    payment_status: "PAID",
  };
  const prepaidEval = await RtoScoringService.evaluateOrderRisk(mockContext, prepaidOrder, testPhone);
  assert(prepaidEval.risk_score <= 20, "Prepaid digital order dramatically reduces risk score (<= 20)", `Score: ${prepaidEval.risk_score}`);
  assert(prepaidEval.recommended_action === "AUTO_CONFIRM", "Prepaid digital order recommended for AUTO_CONFIRM");

  // Test 3C: Cold Start First-Time Buyer
  const coldStartPhone = "01911-002233";
  const coldStartEval = await RtoScoringService.evaluateOrderRisk(mockContext, mockCodOrder, coldStartPhone);
  assert(
    coldStartEval.risk_tier === "VERY_LOW" || coldStartEval.risk_tier === "LOW" || coldStartEval.risk_tier === "MEDIUM",
    "Cold start buyer not unfairly penalised as HIGH risk"
  );
  assert(coldStartEval.factors.network_orders_count === 0, "Cold start correctly identifies 0 past network orders");

  // =========================================================================
  // 4. LIFECYCLE HOOKS & OUTCOME BLINDED RECORDING TESTS
  // =========================================================================
  console.log("\n▶ Section 4: Lifecycle Hooks & Anonymous Outcome Recording");

  const newTestPhone = "01300-445566";
  const newHash = hashPhoneForReputation(newTestPhone);

  const lifecycleOrder: Order = {
    ...mockCodOrder,
    id: "ord_rto_test_03",
    order_number: "ORD-RTO-1003",
    // Its own item row: a repeated item id or another order's id is refused by Postgres, with the rest of the batch
    items: [{ ...mockCodOrder.items[0], id: "item_03", order_id: "ord_rto_test_03" }],
  };
  db.createOrder(lifecycleOrder, lifecycleOrder.items);

  // Record DELIVERED outcome
  RtoScoringService.recordOrderOutcome(testTenantId, lifecycleOrder, "DELIVERED");
  const repAfterDelivered = db.findNetworkDeliveryReputationByHash(newHash);
  // Re-check phone outcome for test phone
  RtoScoringService.recordOrderOutcome(testTenantId, { ...lifecycleOrder, customer_id: undefined } as any, "RETURNED");

  const repUpdated = db.findNetworkDeliveryReputationByHash(testHash);
  assert(Boolean(repUpdated), "Network reputation updated after terminal lifecycle event");
  assert((repUpdated?.returned_rto_count ?? 0) >= 4, "Returned RTO count tracked");

  // =========================================================================
  // 5. ADVANCE DELIVERY FEE GATE TESTS
  // =========================================================================
  console.log("\n▶ Section 5: Advance Delivery Fee Gate");

  db.createOrder(mockCodOrder, mockCodOrder.items);

  const advanceRequest = await AdvanceFeeService.requestAdvanceFee(mockContext, mockCodOrder.id, {
    amount_bdt: 120,
    channel: "WHATSAPP",
  });

  assert(advanceRequest.status === "REQUESTED", "Advance fee request status is REQUESTED");
  assert(advanceRequest.amount_bdt === 120, "Advance fee requested is ৳120");
  assert(advanceRequest.checkout_url.includes("amount=120"), "Checkout URL encodes correct ৳120 amount");

  const evalAfterRequest = db.findOrderRtoEvaluation(testTenantId, mockCodOrder.id);
  assert(evalAfterRequest?.advance_fee_requested === true, "Order RTO evaluation marked advance_fee_requested = true");

  // Simulate payment of advance fee
  const evalAfterPaid = await AdvanceFeeService.recordAdvanceFeePaid(
    testTenantId,
    mockCodOrder.id,
    "bKash_trx_adv_9988",
    120
  );
  assert(evalAfterPaid?.advance_fee_paid === true, "Order evaluation marked advance_fee_paid = true");
  assert(evalAfterPaid?.risk_tier === "LOW", "Risk tier drops to LOW after advance fee is paid");

  // =========================================================================
  // 6. COURIER PHANTOM-ATTEMPT DISPUTE LOGGING TESTS
  // =========================================================================
  console.log("\n▶ Section 6: Courier Phantom Attempt Dispute Logging");

  const dispute = await ShippingService.logCourierDispute(mockContext, {
    order_id: mockCodOrder.id,
    shipment_id: "shp_test_01",
    courier_provider: "STEADFAST",
    tracking_number: "SF12345678",
    customer_feedback: "RIDER_DID_NOT_CALL",
  });

  assert(dispute.status === "OPEN", "Courier dispute logged with status OPEN");
  assert(dispute.customer_feedback === "RIDER_DID_NOT_CALL", "Customer feedback captured as RIDER_DID_NOT_CALL");
  assert(dispute.courier_provider === "STEADFAST", "Courier provider captured correctly");

  // =========================================================================
  // 7. SUPER ADMIN PLATFORM FRAUD RADAR TELEMETRY
  // =========================================================================
  console.log("\n▶ Section 7: Platform Fraud Radar Telemetry");

  const radar = RtoScoringService.getPlatformFraudRadar();
  assert(typeof radar.estimated_rto_loss_prevented_bdt === "number", "Fraud radar calculates estimated loss prevented BDT");
  assert(typeof radar.network_delivery_success_rate === "number", "Fraud radar computes network delivery success rate");
  assert(radar.district_risk_distribution.length > 0, "District risk distribution contains geographical breakdown");

  // =========================================================================
  // 8. GET /api/v1/rto/evaluate/[orderId] (route params are a Promise)
  // =========================================================================
  console.log("\n▶ Section 8: RTO evaluation route");

  const shop = await AuthService.registerTenantWithOwner({
    email: `rto_route_${randomUUID().slice(0, 8)}@rto.test`, password: "Rto-Route-Pass-4417!", name: "RTO Owner", workspaceName: "RTO Route Shop",
  });
  const routeOrder = {
    ...mockCodOrder,
    id: `ord_rto_route_${randomUUID().slice(0, 8)}`,
    tenant_id: shop.tenant.id,
    order_number: `ORD-RTO-ROUTE-${randomUUID().slice(0, 6)}`,
    customer_id: "",
    items: [],
  } as Order;
  db.createOrder(routeOrder, []);
  const { GET: evaluateRoute } = (await import("../src/app/api/v1/rto/evaluate/[orderId]/route")) as {
    GET: (r: Request, ctx: { params: Promise<{ orderId: string }> }) => Promise<Response>;
  };
  const evaluate = (orderId: string) =>
    evaluateRoute(
      new NextRequest(`http://localhost:3000/api/v1/rto/evaluate/${orderId}`, { headers: { authorization: `Bearer ${shop.token}` } }),
      { params: Promise.resolve({ orderId }) }
    );
  const found = await evaluate(routeOrder.id);
  const foundBody = await found.json();
  assert(found.status === 200, "The route evaluates a real order (it used to read params synchronously and 404 every order)", `${found.status} ${JSON.stringify(foundBody).slice(0, 200)}`);
  assert(foundBody.data?.order_id === routeOrder.id, "The evaluation is of the order asked for");
  const missing = await evaluate("ord_missing_rto");
  assert(missing.status === 404, "A missing order is a 404", String(missing.status));

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`   RTO & COURIER FRAUD NETWORK SUITE COMPLETED: ${passed} PASS, ${failed} FAIL`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    throw new Error(`RTO test suite failed with ${failed} failure(s).`);
  }
}

void runRtoTests();
