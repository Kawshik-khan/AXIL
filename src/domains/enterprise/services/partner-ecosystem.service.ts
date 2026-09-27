/**
 * CommerceOS Phase 9: Partner Ecosystem & App Marketplace Service
 * Partner applications catalog, permission scoping, installation review, and partner usage tracking.
 */

import { Partner, PartnerApplication, PartnerInstallation } from "@/types/enterprise";

export class PartnerEcosystemService {
  private partnerApps: PartnerApplication[] = [
    {
      id: "papp_chaldal_courier",
      partner_id: "part_chaldal",
      name: "Chaldal Logistics Express",
      description: "Hyperlocal grocery and fragile cold-chain fulfillment adapter.",
      category: "LOGISTICS",
      version: "1.2.0",
      required_scopes: ["read:orders", "write:shipments"],
      is_verified: true,
      pricing_tier: "FREE",
      created_at: new Date().toISOString(),
    },
    {
      id: "papp_tax_bd",
      partner_id: "part_bd_tax",
      name: "NBR Tax & Mushak-6.3 Generator",
      description: "Automated Bangladeshi VAT & NBR compliance invoice generator.",
      category: "ACCOUNTING",
      version: "2.0.1",
      required_scopes: ["read:orders", "read:finance"],
      is_verified: true,
      pricing_tier: "STANDARD",
      created_at: new Date().toISOString(),
    },
    {
      id: "papp_whatsapp_biz",
      partner_id: "part_meta_biz",
      name: "WhatsApp Enterprise Cloud API",
      description: "High-throughput official Meta BSP messaging and interactive catalog templates.",
      category: "COMMUNICATION",
      version: "3.1.0",
      required_scopes: ["read:customers", "write:messages"],
      is_verified: true,
      pricing_tier: "USAGE_BASED",
      created_at: new Date().toISOString(),
    },
  ];

  public listAvailableApps(category?: string): PartnerApplication[] {
    if (!category) return this.partnerApps;
    return this.partnerApps.filter((a) => a.category === category);
  }

  public getAppDetails(appId: string): PartnerApplication | undefined {
    return this.partnerApps.find((a) => a.id === appId);
  }
}

export const partnerEcosystemService = new PartnerEcosystemService();
