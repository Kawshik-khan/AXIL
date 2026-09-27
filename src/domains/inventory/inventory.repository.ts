/**
 * CommerceOS — Inventory Repository
 * Authoritative inventory levels, reservations, stock movements, and warehouses.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute, withTransaction } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import {
  InventoryItem,
  StockMovement,
  StockMovementType,
  InventoryReservation,
  Warehouse,
} from '@/types/commerce';

export class InventoryRepository extends BaseRepository<InventoryItem & Record<string, unknown>> {
  constructor() {
    super('inventory_items', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async getInventoryLevels(
    tenantId: string,
    options?: { warehouse_id?: string; low_stock_only?: boolean }
  ): Promise<(InventoryItem & { product_name: string; sku: string; variant_title: string })[]> {
    if (!this.isNeonConfigured()) {
      return db.getInventory(tenantId, options);
    }

    let whereSQL = `i.tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (options?.warehouse_id) {
      whereSQL += ` AND i.warehouse_id = $${idx++}`;
      params.push(options.warehouse_id);
    }
    if (options?.low_stock_only) {
      whereSQL += ` AND i.stock <= i.low_stock_threshold`;
    }

    const rows = await query<any>(
      `SELECT 
        i.id,
        i.tenant_id,
        i.warehouse_id,
        i.product_variant_id,
        i.stock as quantity_on_hand,
        i.reserved_stock as quantity_reserved,
        (i.stock - i.reserved_stock) as quantity_available,
        i.low_stock_threshold as reorder_point,
        i.updated_at,
        p.title as product_name,
        v.sku,
        v.title as variant_title
      FROM inventory_items i
      LEFT JOIN product_variants v ON i.product_variant_id = v.id AND i.tenant_id = v.tenant_id
      LEFT JOIN products p ON v.product_id = p.id AND i.tenant_id = p.tenant_id
      WHERE ${whereSQL}
      ORDER BY i.updated_at DESC`,
      params
    );

    return rows;
  }

  async adjustStock(
    tenantId: string,
    params: {
      warehouse_id: string;
      product_variant_id: string;
      quantity_delta: number;
      type: StockMovementType;
      reason: string;
      actor_user_id: string;
      reference_type?: string;
      reference_id?: string;
      allow_overselling?: boolean;
    }
  ): Promise<InventoryItem> {
    if (!this.isNeonConfigured()) {
      return db.adjustStock(tenantId, params);
    }

    // Atomic transaction for stock update and movement record
    return withTransaction(async (client) => {
      // Find or lock item
      const itemRes = await client.query(
        `SELECT * FROM inventory_items 
         WHERE tenant_id = $1 AND warehouse_id = $2 AND product_variant_id = $3
         FOR UPDATE`,
        [tenantId, params.warehouse_id, params.product_variant_id]
      );

      let item = itemRes.rows[0];
      if (!item) {
        // Create item if not existing
        const insertRes = await client.query(
          `INSERT INTO inventory_items (id, tenant_id, warehouse_id, product_variant_id, stock, reserved_stock, low_stock_threshold)
           VALUES ($1, $2, $3, $4, 0, 0, 5) RETURNING *`,
          [`inv_${params.product_variant_id}`, tenantId, params.warehouse_id, params.product_variant_id]
        );
        item = insertRes.rows[0];
      }

      const newStock = Number(item.stock) + params.quantity_delta;
      if (newStock < 0 && !params.allow_overselling) {
        throw new Error(`Insufficient inventory: stock cannot fall below zero.`);
      }

      const updatedRes = await client.query(
        `UPDATE inventory_items SET stock = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [newStock, item.id]
      );

      // Record stock movement
      const movementId = `sm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await client.query(
        `INSERT INTO stock_movements (id, tenant_id, product_variant_id, warehouse_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          movementId,
          tenantId,
          params.product_variant_id,
          params.warehouse_id,
          params.type,
          params.quantity_delta,
          params.reference_type || null,
          params.reference_id || null,
          params.reason,
          params.actor_user_id,
        ]
      );

      // Sync local fallback
      try {
        db.adjustStock(tenantId, params);
      } catch {}

      const updated = updatedRes.rows[0];
      return {
        id: updated.id as string,
        tenant_id: updated.tenant_id as string,
        warehouse_id: updated.warehouse_id as string,
        product_variant_id: updated.product_variant_id as string,
        quantity_on_hand: Number(updated.stock),
        quantity_reserved: Number(updated.reserved_stock),
        quantity_available: Number(updated.stock) - Number(updated.reserved_stock),
        reorder_point: Number(updated.low_stock_threshold),
        updated_at: updated.updated_at as string,
      };
    });
  }

  async getWarehouses(tenantId: string): Promise<Warehouse[]> {
    if (!this.isNeonConfigured()) {
      return db.data.warehouses.filter((w) => w.tenant_id === tenantId);
    }
    return query<Warehouse>(
      `SELECT * FROM warehouses WHERE tenant_id = $1 AND is_active = true ORDER BY is_default DESC, name ASC`,
      [tenantId]
    );
  }
}

export const inventoryRepository = new InventoryRepository();
