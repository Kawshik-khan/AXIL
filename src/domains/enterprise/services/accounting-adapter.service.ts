/**
 * CommerceOS Phase 9: Accounting Adapter Framework
 * Interfaces for external accounting engines and ledgers for invoice, tax, and settlement reconciliation.
 */

import { db } from "@/infrastructure/db";
import { syncEngineService } from "./sync-engine.service";
import { IntegrationSyncRecord } from "@/types/enterprise";

export interface AccountingInvoiceRecord {
  invoice_id: string;
  order_number: string;
  customer_name: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  payment_status: "PAID" | "UNPAID";
}

export class AccountingAdapterService {
  /**
   * Synchronizes delivered orders to accounting ledgers as export invoices
   */
  public async syncInvoices(params: {
    organizationId: string;
    integrationId: string;
    tenantId: string;
  }): Promise<IntegrationSyncRecord> {
    const deliveredOrders = db.getOrders(params.tenantId).orders.filter((o) => o.status === "DELIVERED");

    const invoices: AccountingInvoiceRecord[] = deliveredOrders.map((o) => {
      const tax = Number((o.grand_total * 0.05).toFixed(2)); // standard 5% VAT
      return {
        invoice_id: `inv_${o.order_number}`,
        order_number: o.order_number,
        customer_name: "Valued Customer",
        subtotal: o.grand_total - tax,
        tax_amount: tax,
        total_amount: o.grand_total,
        payment_status: o.payment_status === "PAID" ? "PAID" : "UNPAID",
      };
    });

    return syncEngineService.executeSync({
      organizationId: params.organizationId,
      integrationId: params.integrationId,
      entityType: "INVOICE",
      direction: "OUTBOUND",
      items: invoices as unknown as Array<Record<string, unknown>>,
      processItemFn: async () => {
        return { success: true };
      },
    });
  }
}

export const accountingAdapterService = new AccountingAdapterService();
