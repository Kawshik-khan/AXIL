/**
 * CommerceOS Phase 9: CRM Adapter Framework
 * Interfaces for enterprise CRM systems (Salesforce, HubSpot, Zoho) for contact and lead synchronization.
 */

import { db } from "@/infrastructure/db";
import { dataMappingService } from "./data-mapping.service";
import { syncEngineService } from "./sync-engine.service";
import { IntegrationSyncRecord } from "@/types/enterprise";

export interface ExternalCRMContact {
  crm_id: string;
  full_name: string;
  phone_num: string;
  email_addr?: string;
  lifecycle_stage?: string;
}

export class CrmAdapterService {
  /**
   * Synchronizes external CRM contacts into CommerceOS customer records
   */
  public async syncContacts(params: {
    organizationId: string;
    integrationId: string;
    tenantId: string;
    contacts: ExternalCRMContact[];
  }): Promise<IntegrationSyncRecord> {
    const mapping = dataMappingService.createMapping(params.organizationId, params.integrationId, "CUSTOMER", [
      { source_field: "phone_num", target_field: "phone", data_type: "STRING", transformation: "TRIM", is_required: true },
      { source_field: "full_name", target_field: "name", data_type: "STRING", transformation: "TRIM", is_required: true },
      { source_field: "email_addr", target_field: "email", data_type: "STRING", transformation: "LOWERCASE", is_required: false },
    ]);

    return syncEngineService.executeSync({
      organizationId: params.organizationId,
      integrationId: params.integrationId,
      entityType: "CUSTOMER",
      direction: "BI_DIRECTIONAL",
      items: params.contacts as unknown as Array<Record<string, unknown>>,
      processItemFn: async (rawItem) => {
        const canonical = dataMappingService.transformInbound(mapping, rawItem);
        const phone = canonical.phone as string;

        const existing = db.findCustomerByPhone(params.tenantId, phone);
        if (existing) {
          // Update existing customer safely
          if (canonical.name) {
            existing.first_name = canonical.name as string;
          }
          if (canonical.email) existing.email = canonical.email as string;
          existing.updated_at = new Date().toISOString();
          return { success: true };
        }

        // Create new customer record
        db.createCustomer({
          id: `cust_crm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          tenant_id: params.tenantId,
          first_name: (canonical.name as string) || "CRM",
          last_name: "Contact",
          phone,
          email: (canonical.email as string) || undefined,
          status: "ACTIVE",
          source: "WEBSITE",
          total_orders: 0,
          total_spent: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        return { success: true };
      },
    });
  }
}

export const crmAdapterService = new CrmAdapterService();
