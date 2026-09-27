import { OrderStatus } from "@/types/commerce";
import { BadRequestError } from "@/lib/errors";

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "RETURN_REQUESTED"],
  DELIVERED: ["RETURN_REQUESTED"],
  CANCELLED: [], // Terminal state
  RETURN_REQUESTED: ["RETURNED", "DELIVERED"],
  RETURNED: ["REFUNDED"],
  REFUNDED: [], // Terminal state
};

export class OrderStateMachine {
  public static canTransition(current: OrderStatus, target: OrderStatus): boolean {
    if (current === target) return true;
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(target);
  }

  public static assertTransition(current: OrderStatus, target: OrderStatus): void {
    if (!this.canTransition(current, target)) {
      throw new BadRequestError(
        `Illegal order status transition: Cannot transition from '${current}' to '${target}'.`
      );
    }
  }

  public static getAllowedTransitions(current: OrderStatus): OrderStatus[] {
    return ALLOWED_TRANSITIONS[current] || [];
  }
}
