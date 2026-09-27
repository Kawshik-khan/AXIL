/**
 * CommerceOS Phase 8: Operational Digital Twin Service
 * Read-model projection engine that continuously constructs a multi-domain operational snapshot.
 * Commerce Core remains the authoritative source of truth.
 */

import { db } from "@/infrastructure/db";
import { OperationalDigitalTwin, OperationalDomainSummary, ProviderStatus } from "@/types/operations";
import { providerHealthService } from "./provider-health.service";
import { operationalBudgetService } from "./operational-budget.service";

export class OperationalTwinService {
  /**
   * Generates a live Operational Digital Twin projection for the specified tenant.
   */
  public getDigitalTwin(tenantId: string): OperationalDigitalTwin {
    const inventory = db.getInventory(tenantId);
    const orders = db.getOrders(tenantId).orders;
    const shipments = db.getShipments(tenantId);
    const payments = db.getPayments(tenantId);
    const exceptions = db.getOperationalExceptions(tenantId).filter((e) => e.status !== "RESOLVED");
    const purchaseOrders = db.getPurchaseOrders(tenantId);
    const pricingRules = db.getPricingRules(tenantId);
    const priceChangeRequests = db.getPriceChangeRequests(tenantId);
    const courierPerformances = db.getCourierPerformances(tenantId);
    const supportTickets = db.getSupportTickets(tenantId);
    const returns = db.getReturns(tenantId);
    const budget = operationalBudgetService.getBudget(tenantId);
    const providers = providerHealthService.getProviderHealthMap(tenantId);

    // 1. Inventory Analysis
    const lowStockItems = inventory.filter((i) => i.quantity_available <= i.reorder_point);
    const deadStockItems = inventory.filter((i) => i.quantity_available > 0 && i.quantity_reserved === 0);
    const inventoryDomain: OperationalDomainSummary = {
      domain: "Inventory",
      status: lowStockItems.length > 5 ? "CRITICAL" : lowStockItems.length > 0 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: lowStockItems.length,
      open_exceptions_count: exceptions.filter((e) => e.domain === "INVENTORY").length,
      sla_compliance_percent: 96.5,
      last_automated_action: "Safety stock reorder threshold evaluated",
      metrics: {
        total_sku_count: inventory.length,
        low_stock_sku_count: lowStockItems.length,
        dead_stock_sku_count: deadStockItems.length,
        total_units_on_hand: inventory.reduce((sum, i) => sum + i.quantity_on_hand, 0),
        total_units_available: inventory.reduce((sum, i) => sum + i.quantity_available, 0),
        total_units_reserved: inventory.reduce((sum, i) => sum + i.quantity_reserved, 0),
      },
    };

    // 2. Procurement Analysis
    const pendingPOs = purchaseOrders.filter((po) => po.status === "PENDING_APPROVAL" || po.status === "SENT");
    const procurementDomain: OperationalDomainSummary = {
      domain: "Procurement",
      status: pendingPOs.some((po) => po.status === "PENDING_APPROVAL") ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: pendingPOs.length,
      open_exceptions_count: exceptions.filter((e) => e.domain === "PROCUREMENT").length,
      sla_compliance_percent: 94.0,
      last_automated_action: "Purchase order replenishment draft generated",
      metrics: {
        active_supplier_count: db.getSuppliers(tenantId).filter((s) => s.status === "ACTIVE").length,
        open_po_count: pendingPOs.length,
        pending_po_value_bdt: pendingPOs.reduce((sum, po) => sum + po.total_amount, 0),
      },
    };

    // 3. Pricing Operations
    const pendingPriceChanges = priceChangeRequests.filter((p) => p.status === "PENDING_APPROVAL");
    const pricingDomain: OperationalDomainSummary = {
      domain: "Pricing",
      status: pendingPriceChanges.length > 0 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: pendingPriceChanges.length,
      open_exceptions_count: exceptions.filter((e) => e.domain === "PRICING").length,
      sla_compliance_percent: 99.0,
      last_automated_action: "Catalog margin floor audit verified",
      metrics: {
        active_rules_count: pricingRules.filter((r) => r.is_active).length,
        pending_price_changes: pendingPriceChanges.length,
        executed_today: priceChangeRequests.filter((p) => p.status === "EXECUTED").length,
      },
    };

    // 4. Orders Operations
    const pendingFulfillmentOrders = orders.filter((o) => o.status === "CONFIRMED" || o.status === "PROCESSING");
    const delayedOrders = orders.filter((o) => {
      if (o.status === "DELIVERED" || o.status === "CANCELLED" || o.status === "REFUNDED") return false;
      const ageHours = (Date.now() - new Date(o.created_at).getTime()) / 3600000;
      return ageHours > 24;
    });
    const ordersDomain: OperationalDomainSummary = {
      domain: "Orders",
      status: delayedOrders.length > 3 ? "CRITICAL" : delayedOrders.length > 0 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: pendingFulfillmentOrders.length,
      open_exceptions_count: exceptions.filter((e) => e.domain === "ORDERS").length,
      sla_compliance_percent: orders.length > 0 ? Math.round(((orders.length - delayedOrders.length) / orders.length) * 100) : 100,
      last_automated_action: "Automated payment confirmation verified",
      metrics: {
        total_active_orders: orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED").length,
        pending_fulfillment: pendingFulfillmentOrders.length,
        delayed_orders_count: delayedOrders.length,
      },
    };

    // 5. Fulfillment Operations
    const fulfillmentPlans = db.getFulfillmentPlans(tenantId);
    const fulfillmentDomain: OperationalDomainSummary = {
      domain: "Fulfillment",
      status: "HEALTHY",
      active_tasks_count: fulfillmentPlans.filter((fp) => fp.status !== "DISPATCHED").length,
      open_exceptions_count: exceptions.filter((e) => e.domain === "FULFILLMENT").length,
      sla_compliance_percent: 95.5,
      last_automated_action: "Multi-warehouse stock allocation optimized",
      metrics: {
        plans_in_progress: fulfillmentPlans.filter((fp) => fp.status === "READY_FOR_PICKING" || fp.status === "PICKED").length,
        ready_to_ship_count: orders.filter((o) => o.status === "READY_TO_SHIP").length,
      },
    };

    // 6. Shipping & Courier Operations
    const delayedShipments = shipments.filter((s) => {
      if (s.status === "DELIVERED" || s.status === "CANCELLED" || s.status === "RETURNED") return false;
      const ageHours = (Date.now() - new Date(s.created_at).getTime()) / 3600000;
      return ageHours > 36;
    });
    const shippingExceptions = db.getShipmentExceptions(tenantId).filter((se) => se.status !== "RESOLVED");
    const shippingDomain: OperationalDomainSummary = {
      domain: "Shipping",
      status: shippingExceptions.length > 0 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: shipments.filter((s) => s.status === "IN_TRANSIT" || s.status === "OUT_FOR_DELIVERY").length,
      open_exceptions_count: shippingExceptions.length,
      sla_compliance_percent: 92.0,
      last_automated_action: "Courier transit telemetry polled",
      metrics: {
        in_transit_count: shipments.filter((s) => s.status === "IN_TRANSIT" || s.status === "OUT_FOR_DELIVERY").length,
        delayed_transit_count: delayedShipments.length,
        open_courier_exceptions: shippingExceptions.length,
      },
    };

    // 7. Payment Operations
    const unverifiedPayments = payments.filter((p) => p.status === "PENDING" && p.provider !== "COD");
    const paymentExceptions = db.getPaymentExceptions(tenantId).filter((pe) => pe.status !== "RESOLVED");
    const paymentsDomain: OperationalDomainSummary = {
      domain: "Payments",
      status: paymentExceptions.length > 0 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: unverifiedPayments.length,
      open_exceptions_count: paymentExceptions.length,
      sla_compliance_percent: 98.2,
      last_automated_action: "MFS transaction ledger matched",
      metrics: {
        unverified_online_payments: unverifiedPayments.length,
        unverified_amount_bdt: unverifiedPayments.reduce((sum, p) => sum + p.amount, 0),
        payment_exceptions_count: paymentExceptions.length,
      },
    };

    // 8. Finance Operations
    const reconRuns = db.getReconciliationRuns(tenantId);
    const finExceptions = db.getFinancialExceptions(tenantId).filter((fe) => fe.status !== "RESOLVED");
    const financeDomain: OperationalDomainSummary = {
      domain: "Finance",
      status: finExceptions.length > 0 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: finExceptions.length,
      open_exceptions_count: finExceptions.length,
      sla_compliance_percent: 97.0,
      last_automated_action: "Daily courier COD reconciliation completed",
      metrics: {
        last_reconciliation_date: reconRuns[0]?.run_date || new Date().toISOString().split("T")[0],
        discrepancies_detected: finExceptions.length,
        discrepancies_amount_bdt: finExceptions.reduce((sum, fe) => sum + fe.amount_bdt, 0),
      },
    };

    // 9. Customer Support Operations
    const openTickets = supportTickets.filter((st) => st.status === "OPEN" || st.status === "IN_PROGRESS");
    const breachedTickets = openTickets.filter((st) => st.is_sla_breached);
    const supportDomain: OperationalDomainSummary = {
      domain: "Customer Support",
      status: breachedTickets.length > 0 ? "CRITICAL" : openTickets.length > 5 ? "ATTENTION_REQUIRED" : "HEALTHY",
      active_tasks_count: openTickets.length,
      open_exceptions_count: breachedTickets.length,
      sla_compliance_percent: openTickets.length > 0 ? Math.round(((openTickets.length - breachedTickets.length) / openTickets.length) * 100) : 100,
      last_automated_action: "Banglish delivery inquiry resolved",
      metrics: {
        open_tickets_count: openTickets.length,
        breached_sla_tickets: breachedTickets.length,
        escalations_today: supportTickets.filter((st) => st.status === "ESCALATED").length,
      },
    };

    // 10. Returns Operations
    const activeReturns = returns.filter((r) => r.status === "REQUESTED" || r.status === "RECEIVED");
    const returnsDomain: OperationalDomainSummary = {
      domain: "Returns",
      status: "HEALTHY",
      active_tasks_count: activeReturns.length,
      open_exceptions_count: exceptions.filter((e) => e.domain === "RETURNS").length,
      sla_compliance_percent: 95.0,
      last_automated_action: "Return eligibility rule verified",
      metrics: {
        active_returns_count: activeReturns.length,
        completed_returns: returns.filter((r) => r.status === "COMPLETED").length,
      },
    };

    // Health Score Calculation
    let deduction = 0;
    if (lowStockItems.length > 0) deduction += Math.min(lowStockItems.length * 3, 20);
    if (delayedOrders.length > 0) deduction += Math.min(delayedOrders.length * 5, 25);
    if (shippingExceptions.length > 0) deduction += Math.min(shippingExceptions.length * 4, 20);
    if (paymentExceptions.length > 0) deduction += Math.min(paymentExceptions.length * 5, 20);
    if (breachedTickets.length > 0) deduction += Math.min(breachedTickets.length * 6, 20);
    const healthScore = Math.max(10, 100 - deduction);

    // System Operating Mode
    let systemMode: OperationalDigitalTwin["system_mode"] = "AUTONOMOUS";
    if (budget.emergency_stopped) {
      systemMode = "EMERGENCY_HALTED";
    } else if (budget.is_budget_exhausted) {
      systemMode = "COPILOT";
    } else if (healthScore < 60) {
      systemMode = "SEMI_AUTONOMOUS";
    }

    const pendingApprovalsCount = db.getApprovalRequests(tenantId).filter((a) => a.status === "PENDING").length;

    return {
      tenant_id: tenantId,
      generated_at: new Date().toISOString(),
      overall_health_score: healthScore,
      system_mode: systemMode,
      domains: {
        inventory: inventoryDomain,
        procurement: procurementDomain,
        pricing: pricingDomain,
        orders: ordersDomain,
        fulfillment: fulfillmentDomain,
        shipping: shippingDomain,
        payments: paymentsDomain,
        finance: financeDomain,
        support: supportDomain,
        returns: returnsDomain,
      },
      summary_metrics: {
        inventory_items_at_risk: lowStockItems.length,
        pending_purchase_orders_value_bdt: pendingPOs.reduce((sum, po) => sum + po.total_amount, 0),
        active_price_adjustments_24h: priceChangeRequests.length,
        orders_at_sla_risk: delayedOrders.length,
        shipment_delay_count: delayedShipments.length,
        unreconciled_payments_bdt: unverifiedPayments.reduce((sum, p) => sum + p.amount, 0),
        open_exceptions_count: exceptions.length,
        pending_approvals_count: pendingApprovalsCount,
        budget_used_today_percent: Math.round((budget.actions_used_today / budget.daily_max_actions) * 100),
      },
      provider_health: providers,
    };
  }
}

export const operationalTwinService = new OperationalTwinService();
