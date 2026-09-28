/**
 * The only writer of order status (FIX_IMPLEMENTATION_PLAN FX-35, audit H12/M2/M3).
 *
 * Twelve places used to set order status directly, so an order could jump states the state machine forbids, a courier
 * "delivered" could revive a cancelled order, and stock reservations were released or committed only on some paths.
 * Every status change now goes through `advance`, which:
 * - applies the state machine: people move one legal step at a time; system and courier actors may walk forward from
 *   CONFIRMED through the fulfilment steps (a shipment booked for a confirmed order moves it to READY_TO_SHIP);
 * - applies the side effects of each step: stock re-reserved or held longer on confirmation, released on cancellation,
 *   committed when shipped or delivered, and cash-on-delivery marked paid on delivery;
 * - records an event per step, with who did it and why.
 */
import { db } from "@/infrastructure/db";
import { newId } from "@/lib/ids";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { OrderStateMachine } from "./order-state-machine";
import type { Order, OrderStatus } from "@/types/commerce";

export interface LifecycleActor {
  type: "USER" | "SYSTEM" | "COURIER";
  id: string;
}

const FORWARD: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED"];
const CLOSED: OrderStatus[] = ["CANCELLED", "RETURNED", "REFUNDED"];
/** How long stock stays reserved once an order is confirmed (then it's committed at shipping or released on cancel). */
const CONFIRMED_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

export class OrderLifecycleService {
  public static advance(tenantId: string, orderId: string, target: OrderStatus, actor: LifecycleActor, reason: string): Order {
    const order = db.findOrderById(tenantId, orderId);
    if (!order) throw new NotFoundError("Order", orderId);

    let steps: OrderStatus[];
    try {
      steps = this.plan(order.status, target, actor);
    } catch (err) {
      // A courier or system event against a closed order is surfaced for review, never applied (FX-35)
      if (actor.type !== "USER" && CLOSED.includes(order.status)) this.recordRejectedEvent(order, target, actor, reason);
      throw err;
    }

    for (const next of steps) {
      const current = (db.findOrderById(tenantId, orderId) as Order).status;
      OrderStateMachine.assertTransition(current, next);
      this.sideEffects(tenantId, order, next, actor);
      db.updateOrderStatus(tenantId, orderId, next);
      db.recordEvent({
        id: newId("evt"),
        type: `order.${next.toLowerCase()}`,
        version: "1.0",
        tenant_id: tenantId,
        aggregate_type: "order",
        aggregate_id: orderId,
        actor_id: actor.id,
        correlation_id: order.order_number,
        timestamp: new Date().toISOString(),
        payload: { order_number: order.order_number, from: current, to: next, reason, actor_type: actor.type },
      });
    }
    return db.findOrderById(tenantId, orderId) as Order;
  }

  /** The steps from `from` to `to`, or a 409 when there's no legal path for this actor. */
  private static plan(from: OrderStatus, to: OrderStatus, actor: LifecycleActor): OrderStatus[] {
    if (from === to) return [];
    if (OrderStateMachine.getAllowedTransitions(from).includes(to)) return [to];
    const i = FORWARD.indexOf(from);
    const j = FORWARD.indexOf(to);
    if (actor.type !== "USER" && i >= FORWARD.indexOf("CONFIRMED") && j > i) return FORWARD.slice(i + 1, j + 1);
    throw new ConflictError(`Order cannot move from ${from} to ${to}.`, { from, to });
  }

  private static sideEffects(tenantId: string, order: Order, next: OrderStatus, actor: LifecycleActor): void {
    const reservations = db.getReservationsForOrder(tenantId, order.id);
    if (next === "CONFIRMED") {
      // Holds that lapsed while the order waited are taken again, or the confirmation fails (no silent overselling)
      const active = reservations.filter((r) => r.status === "ACTIVE");
      if (active.length === 0) {
        const taken: string[] = [];
        for (const lapsed of reservations.filter((r) => r.status === "EXPIRED")) {
          try {
            taken.push(
              db.reserveStock(tenantId, {
                order_id: order.id,
                warehouse_id: lapsed.warehouse_id,
                product_variant_id: lapsed.product_variant_id,
                quantity: lapsed.quantity,
              }).id
            );
          } catch {
            // All or nothing: release what this attempt took before refusing
            for (const id of taken) db.releaseReservation(tenantId, id);
            throw new ConflictError("Stock for this order is no longer available; its reservation lapsed before confirmation.", {
              variant_id: lapsed.product_variant_id,
            });
          }
        }
      }
      db.extendReservations(tenantId, order.id, new Date(Date.now() + CONFIRMED_HOLD_MS).toISOString());
    }
    if (next === "CANCELLED") {
      for (const r of reservations.filter((x) => x.status === "ACTIVE")) db.releaseReservation(tenantId, r.id);
    }
    if (next === "SHIPPED" || next === "DELIVERED") {
      for (const r of reservations.filter((x) => x.status === "ACTIVE")) db.commitReservation(tenantId, r.id, actor.id);
    }
    if (next === "DELIVERED" && order.payment_method === "COD" && order.payment_status !== "PAID") {
      // Cash is collected at the door: the delivery confirms the payment (moved from shipping and courier sync)
      for (const p of db.getPayments(tenantId, order.id)) db.updatePaymentStatus(tenantId, p.id, "PAID");
      db.updateOrderPaymentStatus(tenantId, order.id, "PAID");
    }
  }

  private static recordRejectedEvent(order: Order, target: OrderStatus, actor: LifecycleActor, reason: string): void {
    const now = new Date().toISOString();
    db.createOperationalException({
      id: newId("oex"),
      tenant_id: order.tenant_id,
      domain: "ORDERS",
      exception_type: "EVENT_ON_CLOSED_ORDER",
      severity: "HIGH",
      status: "DETECTED",
      title: `${actor.type === "COURIER" ? "Courier" : "System"} tried to move ${order.status} order ${order.order_number} to ${target}`,
      description: `Not applied: a ${order.status} order can't become ${target}. Check with the courier or customer. (${reason})`,
      entity_type: "ORDER",
      entity_id: order.id,
      evidence: { order_status: order.status, requested_status: target, actor },
      assigned_agent: "SUPERVISOR",
      created_at: now,
      updated_at: now,
    });
  }
}
