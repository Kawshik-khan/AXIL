import { z } from "zod";
import crypto from "crypto";
import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { PlatformAuditService } from "@/domains/platform/services/platform-audit.service";
import { db } from "@/infrastructure/db";
import { NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";
import { loadTenantRows } from "@/infrastructure/db/tenant-rows";

const ExportBody = z
  .object({
    tenant_id: z.string().min(1),
  })
  .strict();

async function handlePOST(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "tenant.read");
    PlatformAuthorizationService.assertStepUp(context, "security.manage");

    const body = ExportBody.parse(await request.json());
    const tenant = db.findTenantById(body.tenant_id);
    if (!tenant) throw new NotFoundError("Tenant", body.tenant_id);

    // Collect tenant entities (read-only bundle); zero-hydration: this tenant's rows from Postgres
    await loadTenantRows(tenant.id, ["orders", "products", "product_variants", "customers", "customer_addresses"]);
    const orders = db.getAllOrders(tenant.id);
    const products = db.getAllProducts(tenant.id);
    const customers = db.getAllCustomers(tenant.id);
    const platformAudits = db.getPlatformAuditLogs({ tenantId: tenant.id }).logs;

    const exportData = {
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      tenant_slug: tenant.slug,
      exported_at: new Date().toISOString(),
      operator_id: context.platformUser.id,
      manifest: {
        orders_count: orders.length,
        products_count: products.length,
        customers_count: customers.length,
        audit_events_count: platformAudits.length,
      },
      data: {
        orders,
        products,
        customers,
        audit_logs: platformAudits,
      },
    };

    const checksum = crypto
      .createHash("sha256")
      .update(JSON.stringify(exportData))
      .digest("hex");

    PlatformAuditService.record(
      {
        action: "platform.compliance.export_generated",
        resource_type: "tenant",
        resource_id: tenant.id,
        target_tenant_id: tenant.id,
        reason: "Generated GDPR / BD Data Protection Act compliance export manifest",
        result: "SUCCESS",
        after_state: {
          checksum,
          records_total: orders.length + products.length + customers.length + platformAudits.length,
        },
      },
      context
    );

    return apiSuccess({
      ...exportData,
      checksum_sha256: checksum,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
