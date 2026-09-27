/**
 * CommerceOS — Shipping Repository
 * Authoritative data access for shipments and courier status via Neon PostgreSQL.
 * Backed by Neon PostgreSQL with fallback support.
 */

import { BaseRepository } from '@/infrastructure/db/base-repository';
import { query, queryOne, execute } from '@/infrastructure/neon/client';
import { db } from '@/infrastructure/db';
import { Shipment, DeliveryStatus } from '@/types/commerce';

export class ShippingRepository extends BaseRepository<any> {
  constructor() {
    super('shipments', 'id');
  }

  private isNeonConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async findById(tenantId: string, id: string): Promise<Shipment | null> {
    if (!this.isNeonConfigured()) {
      return db.findShipmentById(tenantId, id) || null;
    }
    return queryOne<Shipment>(
      `SELECT * FROM shipments WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, id]
    );
  }

  async listShipments(tenantId: string, orderId?: string): Promise<Shipment[]> {
    if (!this.isNeonConfigured()) {
      return db.getShipments(tenantId, orderId);
    }
    if (orderId) {
      return query<Shipment>(
        `SELECT * FROM shipments WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at DESC`,
        [tenantId, orderId]
      );
    }
    return query<Shipment>(
      `SELECT * FROM shipments WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
  }

  async createShipment(shipment: Shipment): Promise<Shipment> {
    if (!this.isNeonConfigured()) {
      return db.createShipment(shipment);
    }

    const shp = shipment as any;
    const created = await queryOne<Shipment>(
      `INSERT INTO shipments (
        id, tenant_id, order_id, courier, consignment_id, tracking_code,
        status, delivery_fee, cod_amount, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        shp.id,
        shp.tenant_id,
        shp.order_id,
        shp.courier_provider || shp.courier,
        shp.tracking_code || shp.consignment_id || shp.id,
        shp.tracking_code || null,
        shp.delivery_status || shp.status || 'PENDING',
        shp.shipping_charge || shp.delivery_fee || 0,
        shp.cod_amount || 0,
        shp.created_at || new Date().toISOString(),
        shp.updated_at || new Date().toISOString(),
      ]
    );

    const result = {
      ...shipment,
      ...(created || {}),
      courier_provider: (created as any)?.courier || shp.courier_provider,
      delivery_status: (created as any)?.status || shp.delivery_status,
    } as any as Shipment;

    db.createShipment(result);
    return result;
  }

  async updateShipmentStatus(
    tenantId: string,
    shipmentId: string,
    status: DeliveryStatus,
    trackingCode?: string
  ): Promise<Shipment | null> {
    if (!this.isNeonConfigured()) {
      return (db as any).updateShipmentStatus(tenantId, shipmentId, status, trackingCode) || null;
    }

    let sqlStr = `UPDATE shipments SET status = $1, updated_at = NOW()`;
    const params: unknown[] = [status, tenantId, shipmentId];
    if (trackingCode) {
      sqlStr = `UPDATE shipments SET status = $1, tracking_code = $4, updated_at = NOW()`;
      params.push(trackingCode);
    }
    sqlStr += ` WHERE tenant_id = $2 AND id = $3 RETURNING *`;

    const updated = await queryOne<Shipment>(sqlStr, params);
    (db as any).updateShipmentStatus(tenantId, shipmentId, status, trackingCode);
    if (!updated) return null;
    return {
      ...updated,
      courier_provider: (updated as any)?.courier || (updated as any)?.courier_provider,
      delivery_status: (updated as any)?.status || (updated as any)?.delivery_status,
    } as any as Shipment;
  }
}

export const shippingRepository = new ShippingRepository();
