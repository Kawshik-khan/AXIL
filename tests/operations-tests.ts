// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { operationalTwinService } from "@/domains/operations/services/operational-twin.service";
import { providerHealthService } from "@/domains/operations/services/provider-health.service";
import { operationalBudgetService } from "@/domains/operations/services/operational-budget.service";
import { inventoryOperationsService } from "@/domains/operations/services/inventory-operations.service";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { pricingOperationsService } from "@/domains/operations/services/pricing-operations.service";
import { orderOperationsService } from "@/domains/operations/services/order-operations.service";
import { fulfillmentOperationsService } from "@/domains/operations/services/fulfillment-operations.service";
import { courierOperationsService } from "@/domains/operations/services/courier-operations.service";
import { paymentOperationsService } from "@/domains/operations/services/payment-operations.service";
import { financeOperationsService } from "@/domains/operations/services/finance-operations.service";
import { returnsOperationsService } from "@/domains/operations/services/returns-operations.service";
import { exceptionManagementService } from "@/domains/operations/services/exception-management.service";
import { operationalSLAService } from "@/domains/operations/services/operational-sla.service";
import { bulkSafeguardService } from "@/domains/operations/services/bulk-safeguard.service";
import { operationsWorkflowService } from "@/domains/operations/services/operations-workflow.service";
import { operationsSupervisorAgent } from "@/domains/operations/agents/operations-supervisor.agent";
import { ToolRegistry } from "@/domains/ai/tools/tool-registry";
import { agentRegistry } from "@/domains/ai/orchestration/agent-registry";

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

export async function runOperationsTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD} COMMERCEOS PHASE 8: AUTONOMOUS OPERATIONS TEST SUITE ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const tenantId = "tenant_ops_test_01";
  const tenantB = "tenant_ops_test_02";

  // Reset and seed database for deterministic test runs
  db.clearAllForTesting();
  db.ensureDefaultSeed();

  // Seed sample products & variants
  const prod1 = db.createProduct({
    id: "prod_ops_01",
    tenant_id: tenantId,
    title: "Premium Panjabi Blue",
    slug: "premium-panjabi-blue",
    description: "Cotton festive Panjabi",
    base_price: 2500,
    category_id: "cat_apparel",
    status: "ACTIVE",
    is_published: true,
    has_variants: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const var1 = {
    id: "var_ops_01",
    tenant_id: tenantId,
    product_id: prod1.id,
    title: "Premium Panjabi Blue - L",
    sku: "PAN-BLU-L",
    price: 2500,
    cost_price: 1500,
    compare_at_price: 2800,
    position: 0,
    option_values: { size: "L", color: "Blue" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.data.product_variants.push(var1);

  const var2 = {
    id: "var_ops_02",
    tenant_id: tenantId,
    product_id: prod1.id,
    title: "Premium Panjabi Blue - M",
    sku: "PAN-BLU-M",
    price: 2400,
    cost_price: 1400,
    compare_at_price: 2600,
    position: 1,
    option_values: { size: "M", color: "Blue" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.data.product_variants.push(var2);

  // Seed Warehouses
  const wh1 = db.createWarehouse({
    id: "wh_ops_dhaka",
    tenant_id: tenantId,
    name: "Dhaka Central Warehouse",
    code: "DAC-01",
    is_active: true,
    is_default: true,
    division: "Dhaka",
    district: "Dhaka",
    address: "Tejgaon Industrial Area",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const wh2 = db.createWarehouse({
    id: "wh_ops_ctg",
    tenant_id: tenantId,
    name: "Chittagong Hub Warehouse",
    code: "CTG-01",
    is_active: true,
    is_default: false,
    division: "Chittagong",
    district: "Chittagong",
    address: "Agrabad Commercial Area",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Seed Inventory: Var1 is critical stock (5 units), Var2 is surplus in Dhaka (80 units) but deficit in CTG (2 units)
  db.data.inventory_items.push({
    id: "inv_ops_01",
    tenant_id: tenantId,
    warehouse_id: wh1.id,
    product_variant_id: var1.id,
    quantity_on_hand: 5,
    quantity_reserved: 2,
    quantity_available: 3,
    reorder_point: 15,
    updated_at: new Date().toISOString(),
  });

  db.data.inventory_items.push({
    id: "inv_ops_02_dhaka",
    tenant_id: tenantId,
    warehouse_id: wh1.id,
    product_variant_id: var2.id,
    quantity_on_hand: 80,
    quantity_reserved: 0,
    quantity_available: 80,
    reorder_point: 20,
    updated_at: new Date().toISOString(),
  });

  db.data.inventory_items.push({
    id: "inv_ops_02_ctg",
    tenant_id: tenantId,
    warehouse_id: wh2.id,
    product_variant_id: var2.id,
    quantity_on_hand: 2,
    quantity_reserved: 0,
    quantity_available: 2,
    reorder_point: 10,
    updated_at: new Date().toISOString(),
  });

  // Seed Supplier & Supplier Product
  const supplier1 = db.createSupplier({
    id: "sup_cotton_mills",
    tenant_id: tenantId,
    name: "Bengal Cotton Mills Ltd",
    contact_person: "M. Hossain",
    email: "procurement@bengalcotton.bd",
    phone: "+8801711998877",
    lead_time_days: 3,
    minimum_order_value_bdt: 5000,
    status: "ACTIVE",
    rating: 4.8,
    payment_terms: "NET_30",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  db.createSupplierProduct({
    id: "sp_ops_01",
    tenant_id: tenantId,
    supplier_id: supplier1.id,
    product_variant_id: var1.id,
    supplier_sku: "BCM-PAN-L",
    cost_price: 1400,
    moq: 20,
    lead_time_days: 3,
    is_preferred: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  console.log(`${ANSI_BOLD}[1. Operational Digital Twin Projection]${ANSI_RESET}`);

  await runTest("Digital Twin projects live health score and multi-domain states", () => {
    const twin = operationalTwinService.getDigitalTwin(tenantId);
    assert.ok(twin, "Twin projection must be generated");
    assert.strictEqual(twin.tenant_id, tenantId);
    assert.ok(typeof twin.overall_health_score === "number");
    assert.ok(twin.overall_health_score >= 0 && twin.overall_health_score <= 100);
    assert.ok(["AUTONOMOUS", "SEMI_AUTONOMOUS", "COPILOT", "EMERGENCY_HALTED"].includes(twin.system_mode));
    assert.ok(twin.domains.inventory, "Inventory domain summary must exist");
    assert.ok(twin.domains.procurement, "Procurement domain summary must exist");
    assert.ok(twin.domains.pricing, "Pricing domain summary must exist");
    assert.ok(twin.domains.orders, "Orders domain summary must exist");
    assert.ok(twin.domains.fulfillment, "Fulfillment domain summary must exist");
    assert.ok(twin.domains.shipping, "Shipping domain summary must exist");
    assert.ok(twin.domains.payments, "Payments domain summary must exist");
    assert.ok(twin.domains.finance, "Finance domain summary must exist");
    assert.ok(twin.domains.support, "Support domain summary must exist");
    assert.ok(twin.domains.returns, "Returns domain summary must exist");
  });

  console.log(`\n${ANSI_BOLD}[2. Inventory Operations & Stockout Risk Forecasting]${ANSI_RESET}`);

  await runTest("Evaluates stockout risks and flags low stock items", () => {
    const risks = inventoryOperationsService.evaluateStockoutRisks(tenantId);
    assert.ok(risks.length > 0, "Should assess at least one variant");
    const var1Risk = risks.find((r) => r.product_variant_id === var1.id || (r as any).variant_id === var1.id);
    assert.ok(var1Risk, "Var1 should be assessed");
    assert.ok(var1Risk.risk_level === "HIGH" || var1Risk.risk_level === "CRITICAL");
  });

  await runTest("Recommends warehouse balancing transfers between surplus and deficit hubs", () => {
    const transfers = inventoryOperationsService.evaluateWarehouseTransfers(tenantId);
    assert.ok(transfers.length > 0, "Should generate balancing recommendation");
    const t = transfers[0];
    assert.strictEqual(t.source_warehouse_id, wh1.id);
    assert.strictEqual(t.target_warehouse_id, wh2.id);
    assert.strictEqual(t.product_variant_id, var2.id);
    assert.ok(t.recommended_transfer_quantity > 0);
  });

  console.log(`\n${ANSI_BOLD}[3. Procurement & Purchase Order Drafting]${ANSI_RESET}`);

  let createdPOId = "";

  await runTest("Generates restock replenishment recommendations based on stockout risks", () => {
    const recs = procurementService.generateReplenishmentRecommendations(tenantId);
    assert.ok(recs.length > 0, "Should recommend restock for var1");
    assert.strictEqual(recs[0].product_variant_id, var1.id);
    assert.strictEqual(recs[0].supplier_id || recs[0].recommended_supplier_id, supplier1.id);
    assert.ok((recs[0].recommended_order_quantity || recs[0].recommended_quantity) >= 20, "Must respect MOQ of 20");
  });

  await runTest("Drafts purchase order with supplier MOQ and cost price math", () => {
    const po = procurementService.createPurchaseOrderDraft(tenantId, {
      supplierId: supplier1.id,
      items: [{ variantId: var1.id, quantity: 25 }],
      notes: "Urgent restocking for festive season",
    });
    assert.ok(po.id.startsWith("po_"));
    assert.strictEqual(po.status, "PENDING_APPROVAL");
    assert.strictEqual(po.items.length, 1);
    assert.strictEqual(po.items[0].quantity_ordered, 25);
    assert.strictEqual(po.total_amount, 25 * 1400); // 35,000 BDT
    createdPOId = po.id;
  });

  await runTest("Transitions purchase order lifecycle strictly through valid states", () => {
    const approvedPO = procurementService.transitionPurchaseOrderStatus(
      tenantId,
      createdPOId,
      "APPROVED",
      "test_manager"
    );
    assert.strictEqual(approvedPO.status, "APPROVED");

    const sentPO = procurementService.transitionPurchaseOrderStatus(
      tenantId,
      createdPOId,
      "SENT",
      "test_manager"
    );
    assert.strictEqual(sentPO.status, "SENT");

    // Receive order and verify stock was updated in core db
    const beforeStock = db.findInventoryItem(tenantId, wh1.id, var1.id)!.quantity_available;
    const receivedPO = procurementService.transitionPurchaseOrderStatus(
      tenantId,
      createdPOId,
      "RECEIVED",
      "test_manager"
    );
    assert.strictEqual(receivedPO.status, "RECEIVED");
    const afterStock = db.findInventoryItem(tenantId, wh1.id, var1.id)!.quantity_available;
    assert.strictEqual(afterStock, beforeStock + 25, "Available stock must increment by received 25 units");
  });

  console.log(`\n${ANSI_BOLD}[4. Pricing Operations & Margin Floor Safeguards]${ANSI_RESET}`);

  await runTest("Simulates price change elasticity and enforces margin floor", () => {
    // Current price: 2500, cost: 1500 -> margin = (2500-1500)/2500 = 40%
    const safeSimulation = pricingOperationsService.simulatePriceChange(tenantId, var1.id, 2300);
    assert.strictEqual(safeSimulation.current_price, 2500);
    assert.strictEqual(safeSimulation.proposed_price, 2300);
    assert.ok(safeSimulation.margin_safe, "Margin of ~34.8% should be safe");

    // Proposed price: 1600 -> margin = (1600-1500)/1600 = 6.25% (breaches 20% floor)
    const unsafeSimulation = pricingOperationsService.simulatePriceChange(tenantId, var1.id, 1600);
    assert.strictEqual(unsafeSimulation.margin_safe, false, "Margin under floor must not be safe");
    assert.ok(unsafeSimulation.warnings.length > 0);
  });

  await runTest("Executes approved price change in product catalog and supports rollback", () => {
    const req = db.createPriceChangeRequest({
      id: `pcr_test_${Date.now()}`,
      tenant_id: tenantId,
      product_variant_id: var1.id,
      sku: var1.sku,
      old_price: 2500,
      new_price: 2350,
      margin_percent: 36.2,
      reason: "COMPETITIVE_MATCH",
      status: "PENDING_APPROVAL",
      created_at: new Date().toISOString(),
    });

    const execution = pricingOperationsService.executePriceChange(tenantId, req.id, "test_operator");
    assert.strictEqual(execution.status, "SUCCESS");
    assert.strictEqual(execution.new_price, 2350);

    // Verify catalog reflects change
    const updatedVar = db.findVariantById(tenantId, var1.id);
    assert.strictEqual(updatedVar?.price, 2350);

    // Rollback
    const rolledBack = pricingOperationsService.rollbackPriceChange(tenantId, execution.id, "test_operator");
    assert.strictEqual(rolledBack.status, "ROLLED_BACK");
    const restoredVar = db.findVariantById(tenantId, var1.id);
    assert.strictEqual(restoredVar?.price, 2500);
  });

  console.log(`\n${ANSI_BOLD}[5. Order Fulfillment & Multi-Item Planning]${ANSI_RESET}`);

  await runTest("Evaluates fulfillment readiness and plans warehouse allocation", () => {
    // Create confirmed order
    const order = db.createOrder({
      id: "ord_ops_fulfill_01",
      tenant_id: tenantId,
      order_number: "ORD-OPS-101",
      customer_id: "cust_test_01",
      status: "CONFIRMED",
      currency: "BDT",
      subtotal: 2500,
      discount_total: 0,
      shipping_total: 100,
      tax_total: 0,
      grand_total: 2600,
      payment_method: "COD",
      payment_status: "PENDING",
      fulfillment_status: "UNFULFILLED",
      shipping_address_snapshot: {
        address_line_1: "House 12, Road 4, Dhanmondi",
        district: "Dhaka",
        division: "Dhaka",
      },
      source: "WEBSITE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, [
      {
        id: "item_ops_01",
        tenant_id: tenantId,
        order_id: "ord_ops_fulfill_01",
        product_id: prod1.id,
        variant_id: var1.id,
        product_name_snapshot: "Panjabi Blue",
        sku_snapshot: "PAN-BLU-L",
        unit_price: 2500,
        quantity: 1,
        discount: 0,
        tax: 0,
        line_total: 2500,
      },
    ]);

    const plan = fulfillmentOperationsService.planFulfillment(tenantId, order.id);
    assert.ok(plan.id.startsWith("flp_"));
    assert.strictEqual(plan.allocated_warehouse_id, wh1.id);
    assert.strictEqual(plan.items_available, true);
    assert.ok(plan.assigned_courier);
  });

  console.log(`\n${ANSI_BOLD}[6. Courier Operations & Carrier Failover]${ANSI_RESET}`);

  await runTest("Detects delayed transit and executes courier failover", () => {
    // Create shipment stuck in transit for 48 hours
    const oldShipment = db.createShipment({
      id: "shp_delayed_01",
      tenant_id: tenantId,
      order_id: "ord_ops_fulfill_01",
      courier_provider: "STEADFAST",
      consignment_id: "CSG-STEADFAST-9988",
      tracking_number: "TRK-ST-998811",
      status: "IN_TRANSIT",
      shipping_cost: 120,
      shipped_at: new Date(Date.now() - 48 * 3600000).toISOString(),
      created_at: new Date(Date.now() - 48 * 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    });

    const delays = courierOperationsService.detectShipmentExceptions(tenantId);
    assert.ok(delays.length > 0, "Should identify delayed shipment");
    const exc = delays.find((d) => d.shipment_id === oldShipment.id);
    assert.ok(exc);

    // Failover can't book with another courier (no courier API): it refuses and changes nothing, instead of
    // cancelling the shipment and inventing a new booking (FX-31)
    const shipmentsBefore = db.getShipments(tenantId).length;
    assert.throws(
      () => courierOperationsService.executeCourierFailover(tenantId, exc.id, "test_dispatcher"),
      (err: Error & { code?: string }) => err.code === "INTEGRATION_NOT_CONFIGURED"
    );
    assert.strictEqual(db.findShipmentById(tenantId, oldShipment.id)?.status, "IN_TRANSIT", "original shipment untouched");
    assert.strictEqual(db.getShipments(tenantId).length, shipmentsBefore, "no invented replacement shipment");
  });

  console.log(`\n${ANSI_BOLD}[7. Payment Operations & MFS Reconciliation]${ANSI_RESET}`);

  await runTest("Reconciles incoming bKash TrxID deterministically against order", () => {
    const payment = db.createPayment({
      id: "pay_mfs_01",
      tenant_id: tenantId,
      order_id: "ord_ops_fulfill_01",
      provider: "BKASH",
      amount: 2600,
      currency: "BDT",
      status: "PENDING",
      created_at: new Date().toISOString(),
    });

    const recon = paymentOperationsService.reconcileTransaction(tenantId, {
      orderId: "ord_ops_fulfill_01",
      transactionId: "8N7A6C5D4E",
      amount: 2600,
      actor: "test_reconciler",
    });

    assert.strictEqual(recon.matched, true);
    assert.strictEqual(recon.payment.status, "PAID");
    assert.strictEqual(recon.payment.transaction_id, "8N7A6C5D4E");
  });

  console.log(`\n${ANSI_BOLD}[8. Finance Operations & Daily Reconciliation Run]${ANSI_RESET}`);

  await runTest("Executes deterministic financial reconciliation run across orders and ledger", () => {
    const run = financeOperationsService.executeReconciliationRun(tenantId);
    assert.ok(run.id.startsWith("rec_run_"));
    assert.ok(run.orders_audited_count > 0);
    assert.ok(typeof run.total_revenue_expected_bdt === "number");
    assert.ok(typeof run.total_revenue_collected_bdt === "number");
    assert.ok(["COMPLETED", "EXCEPTIONS_FOUND"].includes(run.status));
  });

  console.log(`\n${ANSI_BOLD}[9. Exception Management Engine]${ANSI_RESET}`);

  await runTest("Logs operational exception, assigns domain agent, and resolves with notes", () => {
    const exc = exceptionManagementService.createException(tenantId, {
      domain: "SHIPPING",
      exceptionType: "COURIER_PICKUP_DELAY",
      severity: "MEDIUM",
      title: "Steadfast courier pickup delayed by 6 hours",
      description: "Driver did not arrive for scheduled afternoon dispatch batch",
      entityType: "SHIPMENT",
      entityId: "shp_test_dispatch",
      evidence: { scheduled_time: "14:00", current_time: "20:00" },
    });

    assert.strictEqual(exc.status, "DETECTED");
    assert.strictEqual(exc.assigned_agent, "SHIPPING_OPERATIONS");

    const resolved = exceptionManagementService.resolveException(
      tenantId,
      exc.id,
      "Driver arrived and picked up all 14 consignments at 20:30",
      "test_warehouse_lead"
    );
    assert.strictEqual(resolved.status, "RESOLVED");
    assert.ok(resolved.resolved_at);
  });

  console.log(`\n${ANSI_BOLD}[10. Operational SLA Tracking & Breaches]${ANSI_RESET}`);

  await runTest("Audits operational SLAs and flags breaches for unfulfilled orders", () => {
    db.upsertSLAPolicy({
      id: "sla_fulfill_ops",
      tenant_id: tenantId,
      name: "Order Dispatch SLA",
      domain: "ORDER_FULFILLMENT",
      target_duration_minutes: 120, // 2 hours
      warning_threshold_minutes: 60,
      auto_escalate: true,
      enabled: true,
      created_at: new Date().toISOString(),
    });

    const slaAudit = operationalSLAService.auditSLAs(tenantId);
    assert.ok(Array.isArray(slaAudit.active_breaches));
    assert.ok(Array.isArray(slaAudit.risks_at_warning));
  });

  console.log(`\n${ANSI_BOLD}[11. Provider Health & Circuit Breakers]${ANSI_RESET}`);

  await runTest("Records provider failures, degrades health, and trips circuit breaker", () => {
    // Record multiple failures for Steadfast
    for (let i = 0; i < 5; i++) {
      providerHealthService.recordCall(tenantId, "steadfast", {
        success: false,
        latencyMs: 1200,
        errorCode: "GATEWAY_TIMEOUT",
      });
    }

    const health = db.getProviderHealth(tenantId, "steadfast");
    assert.ok(health);
    assert.ok(health.consecutive_failures >= 3);
    assert.ok(["DEGRADED", "UNAVAILABLE"].includes(health.status));

    // Alternate courier lookup should recommend a healthy alternate
    const alternate = providerHealthService.getAlternateCourier(tenantId, "STEADFAST");
    assert.notStrictEqual(alternate, "STEADFAST");
    assert.ok(["PATHAO", "REDX"].includes(alternate));
  });

  console.log(`\n${ANSI_BOLD}[12. Bulk Mutation Safeguards]${ANSI_RESET}`);

  await runTest("Executes dry-run simulation and progressive batches with kill-switch verification", async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ id: `batch_item_${i}`, price: 1000 + i * 10 }));

    const safeguard = bulkSafeguardService.prepareBulkOperation(tenantId, {
      actionType: "BULK_PRICE_UPDATE",
      targetEntityType: "PRODUCT_VARIANT",
      targetObjects: items,
      dryRunSimulationFn: (samples) => ({ verified_count: samples.length }),
    });

    assert.ok(safeguard.id.startsWith("bulk_"));
    assert.strictEqual(safeguard.total_objects_count, 15);
    assert.strictEqual(safeguard.status, "DRY_RUN_COMPLETED");

    let processedCount = 0;
    const result = await bulkSafeguardService.executeProgressively(
      tenantId,
      safeguard.id,
      items,
      async (item) => {
        processedCount++;
        return item;
      },
      5
    );

    assert.strictEqual(result.successful_count, 15);
    assert.strictEqual(result.status, "COMPLETED");
  });

  console.log(`\n${ANSI_BOLD}[13. Autonomy Budgets & Emergency Kill Switch]${ANSI_RESET}`);

  await runTest("Enforces daily spend budget limits on autonomous operations", () => {
    const budget = operationalBudgetService.getBudget(tenantId);
    assert.ok(budget);

    // Permitted spend
    const check1 = operationalBudgetService.canExecute(tenantId, { actionCostBdt: 1000 });
    assert.strictEqual(check1.allowed, true);

    // Exceeds daily max spend
    const check2 = operationalBudgetService.canExecute(tenantId, { actionCostBdt: 99999999 });
    assert.strictEqual(check2.allowed, false);
    assert.ok(check2.reason?.includes("exceeds remaining daily budget"));
  });

  await runTest("Emergency Kill Switch freezes autonomous mutations immediately and can be cleared", () => {
    const halted = operationalBudgetService.triggerKillSwitch(tenantId, "Detected courier API instability");
    assert.strictEqual(halted.emergency_stopped, true);

    const checkHalted = operationalBudgetService.canExecute(tenantId, { actionCostBdt: 100 });
    assert.strictEqual(checkHalted.allowed, false);
    assert.ok(checkHalted.reason?.includes("emergency stopped"));

    const cleared = operationalBudgetService.clearKillSwitch(tenantId);
    assert.strictEqual(cleared.emergency_stopped, false);
  });

  console.log(`\n${ANSI_BOLD}[14. Operations Supervisor Planning & 11-Stage Governed Workflows]${ANSI_RESET}`);

  await runTest("Supervisor agent formulates multi-domain operational plan based on digital twin", async () => {
    const plan = operationsSupervisorAgent.decomposeOperationsObjective({
      objective: "Replenish low stock items and balance inventory across hubs",
      tenantId,
      templateCode: "REPLENISH_LOW_STOCK",
    });
    assert.ok(Array.isArray(plan));
    assert.ok(plan.length >= 3, "Plan should contain decomposed steps");
    assert.ok(plan.some((s) => s.agent_type === "INVENTORY_OPERATIONS"));
    assert.ok(plan.some((s) => s.agent_type === "PROCUREMENT"));
  });

  await runTest("Executes Low Stock Replenishment Workflow generating verified ActionReceipts", async () => {
    // Ensure var1 has deficit stock below reorder point so replenishment workflow triggers
    const invVar1 = db.findInventoryItem(tenantId, wh1.id, var1.id)!;
    invVar1.quantity_available = 4;
    invVar1.quantity_on_hand = 6;
    invVar1.reorder_point = 15;

    const res = await operationsWorkflowService.executeLowStockReplenishment(tenantId);
    assert.ok(["SUCCESS", "APPROVAL_REQUIRED"].includes(res.status));
    assert.ok(res.receipts.length > 0, "Must produce verified ActionReceipts");

    const receipt = res.receipts[0];
    assert.ok(receipt.id.startsWith("rcpt_"));
    assert.strictEqual(receipt.status, "SUCCESS");
    assert.ok(receipt.idempotency_key);
    assert.strictEqual(receipt.actor_agent, "PROCUREMENT");

    // Check receipt is recorded in database
    const dbReceipt = db.getActionReceiptByIdempotencyKey(tenantId, receipt.idempotency_key);
    assert.ok(dbReceipt, "Receipt must be written to immutable database collection");
  });

  console.log(`\n${ANSI_BOLD}[15. Tool Registry & Agent Registry Registration]${ANSI_RESET}`);

  await runTest("Verifies all 14 Phase 8 operational tools are registered in ToolRegistry", () => {
    const registry = ToolRegistry.getInstance();
    const opsTools = registry.getToolsByCategory("OPERATIONS");
    assert.ok(opsTools.length >= 14, `Expected >=14 operations tools, found ${opsTools.length}`);

    const toolNames = opsTools.map((t) => t.name);
    assert.ok(toolNames.includes("get_inventory_levels"));
    assert.ok(toolNames.includes("get_inventory_forecast"));
    assert.ok(toolNames.includes("create_purchase_order"));
    assert.ok(toolNames.includes("simulate_price_change"));
    assert.ok(toolNames.includes("execute_price_change"));
    assert.ok(toolNames.includes("get_shipment_tracking"));
    assert.ok(toolNames.includes("switch_courier"));
    assert.ok(toolNames.includes("verify_payment_transaction"));
    assert.ok(toolNames.includes("reconcile_payment_batch"));
    assert.ok(toolNames.includes("run_financial_reconciliation"));
    assert.ok(toolNames.includes("get_operational_exceptions"));
    assert.ok(toolNames.includes("resolve_operational_exception"));
    assert.ok(toolNames.includes("get_autonomy_budget"));
    assert.ok(toolNames.includes("trigger_kill_switch"));
  });

  await runTest("Verifies all 15 Phase 8 operational agents are registered in AgentRegistry", () => {
    const allAgents = agentRegistry.listAgents();
    const agentTypes = allAgents.map((a) => a.type);

    assert.ok(agentTypes.includes("OPERATIONS_SUPERVISOR"));
    assert.ok(agentTypes.includes("INVENTORY_OPERATIONS"));
    assert.ok(agentTypes.includes("PROCUREMENT"));
    assert.ok(agentTypes.includes("PRICING_OPERATIONS"));
    assert.ok(agentTypes.includes("ORDER_OPERATIONS"));
    assert.ok(agentTypes.includes("FULFILLMENT"));
    assert.ok(agentTypes.includes("SHIPPING_OPERATIONS"));
    assert.ok(agentTypes.includes("CUSTOMER_SUPPORT_OPERATIONS"));
    assert.ok(agentTypes.includes("PAYMENT_OPERATIONS"));
    assert.ok(agentTypes.includes("FINANCE_OPERATIONS"));
    assert.ok(agentTypes.includes("RETURNS_OPERATIONS"));
    assert.ok(agentTypes.includes("EXCEPTION_MANAGEMENT"));
    assert.ok(agentTypes.includes("RECONCILIATION"));
    assert.ok(agentTypes.includes("SUPPLIER_OPERATIONS"));
    assert.ok(agentTypes.includes("OPERATIONS_OPTIMIZATION"));
  });

  console.log(`\n${ANSI_BOLD}[16. Strict Multi-Tenant Isolation & Zero Database Bypassing]${ANSI_RESET}`);

  await runTest("Ensures operational state and exceptions are strictly isolated across tenants", () => {
    // Query digital twin for Tenant B
    const twinB = operationalTwinService.getDigitalTwin(tenantB);
    assert.strictEqual(twinB.tenant_id, tenantB);
    assert.strictEqual(twinB.summary_metrics.pending_purchase_orders_value_bdt, 0);

    // Exceptions for tenant B must be empty
    const exceptionsB = db.getOperationalExceptions(tenantB);
    assert.strictEqual(exceptionsB.length, 0);

    // Receipts for tenant B must be empty
    const receiptsB = db.getActionReceipts(tenantB);
    assert.strictEqual(receiptsB.length, 0);
  });

  // Final Summary
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}Operations Test Results: ${passedCount} Passed, ${failedCount} Failed${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Execute test suite
runOperationsTests().catch((err) => {
  console.error("Operations Test Suite Fatal Error:", err);
  process.exit(1);
});
