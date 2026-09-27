import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import {
  InventoryItem,
  StockMovement,
  StockMovementType,
  InventoryReservation,
  Warehouse,
} from "@/types/commerce";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError, NotFoundError } from "@/lib/errors";

export class InventoryService {
  public static async getInventoryLevels(
    context: RequestContext,
    options?: { warehouse_id?: string; low_stock_only?: boolean }
  ): Promise<(InventoryItem & { product_name: string; sku: string; variant_title: string })[]> {
    RbacService.assertCan(context, PERMISSIONS.INVENTORY_READ);
    return db.getInventory(context.tenant.id, options);
  }

  public static async adjustStock(
    context: RequestContext,
    params: {
      warehouse_id: string;
      product_variant_id: string;
      quantity_delta: number;
      type: StockMovementType;
      reason: string;
      reference_type?: string;
      reference_id?: string;
    }
  ): Promise<InventoryItem> {
    RbacService.assertCan(context, PERMISSIONS.INVENTORY_ADJUST);

    if (!params.warehouse_id) {
      throw new BadRequestError("Warehouse ID is required for stock adjustment.");
    }
    if (!params.product_variant_id) {
      throw new BadRequestError("Product variant ID is required.");
    }
    if (!params.reason || params.reason.trim().length === 0) {
      throw new BadRequestError("A specific reason is required for every stock adjustment.");
    }
    if (params.quantity_delta === 0) {
      throw new BadRequestError("Quantity delta must be non-zero.");
    }

    const allowOverselling = Boolean(context.tenant.settings?.allow_overselling);

    let updatedItem: InventoryItem;
    try {
      updatedItem = db.adjustStock(context.tenant.id, {
        warehouse_id: params.warehouse_id,
        product_variant_id: params.product_variant_id,
        quantity_delta: params.quantity_delta,
        type: params.type,
        reason: params.reason.trim(),
        actor_user_id: context.user.id,
        reference_type: params.reference_type,
        reference_id: params.reference_id,
        allow_overselling: allowOverselling,
      });
    } catch (err: any) {
      if (err.message && err.message.includes("Insufficient stock")) {
        throw new BadRequestError(err.message);
      }
      throw err;
    }

    db.createAuditLog({
      id: `aud_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      actor_user_id: context.user.id,
      action: "STOCK_ADJUSTED",
      resource_type: "inventory",
      resource_id: params.product_variant_id,
      metadata: {
        warehouse_id: params.warehouse_id,
        quantity_delta: params.quantity_delta,
        new_on_hand: updatedItem.quantity_on_hand,
        reason: params.reason,
      },
      created_at: new Date().toISOString(),
    });

    return updatedItem;
  }

  public static async reserveStock(
    context: RequestContext,
    params: {
      order_id: string;
      warehouse_id: string;
      product_variant_id: string;
      quantity: number;
    }
  ): Promise<InventoryReservation> {
    // Internal reservation check
    return db.reserveStock(context.tenant.id, {
      order_id: params.order_id,
      warehouse_id: params.warehouse_id,
      product_variant_id: params.product_variant_id,
      quantity: params.quantity,
    });
  }

  public static async releaseReservation(
    context: RequestContext,
    reservationId: string
  ): Promise<boolean> {
    return db.releaseReservation(context.tenant.id, reservationId);
  }

  public static async commitReservation(
    context: RequestContext,
    reservationId: string
  ): Promise<boolean> {
    return db.commitReservation(context.tenant.id, reservationId, context.user.id);
  }

  public static async getStockMovements(
    context: RequestContext,
    limit = 50
  ): Promise<StockMovement[]> {
    RbacService.assertCan(context, PERMISSIONS.INVENTORY_READ);
    return db.getStockMovements(context.tenant.id, limit);
  }

  // ==================== WAREHOUSES ====================
  public static async listWarehouses(context: RequestContext): Promise<Warehouse[]> {
    RbacService.assertCan(context, PERMISSIONS.INVENTORY_READ);
    return db.getWarehouses(context.tenant.id);
  }

  public static async createWarehouse(
    context: RequestContext,
    payload: {
      name: string;
      code: string;
      address: string;
      city: string;
      district: string;
      phone?: string;
    }
  ): Promise<Warehouse> {
    RbacService.assertCan(context, PERMISSIONS.INVENTORY_WRITE);

    if (!payload.name || !payload.code) {
      throw new BadRequestError("Warehouse name and code are required.");
    }

    const warehouse: Warehouse = {
      id: `wh_${Date.now()}_${randomSuffix()}`,
      tenant_id: context.tenant.id,
      name: payload.name.trim(),
      code: payload.code.trim().toUpperCase(),
      address: payload.address,
      city: payload.city,
      district: payload.district,
      phone: payload.phone,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return db.createWarehouse(warehouse);
  }
}
