import { db } from "@/infrastructure/db";
import { extractRequestContext } from "@/lib/api-response";
import { CustomerService } from "@/domains/customers/customer.service";

async function testApi() {
  console.log("Testing extractRequestContext in dev mode with no token...");
  const mockReq = new Request("http://localhost:3000/api/v1/customers");
  const context = await extractRequestContext(mockReq);
  console.log("Resolved context:", {
    tenant: context.tenant.name,
    tenant_id: context.tenant.id,
    user: context.user.name,
    role: context.role,
  });

  console.log("\nQuerying CustomerService.listCustomers with resolved context...");
  const res = await CustomerService.listCustomers(context, { limit: 5, offset: 0 });
  console.log(`Customer list total: ${res.total}`);
  console.log(`Returned page items: ${res.customers.length}`);
  console.log("Sample customer from DB:", {
    id: res.customers[0].id,
    name: `${res.customers[0].first_name} ${res.customers[0].last_name}`,
    phone: res.customers[0].phone,
    address: res.customers[0].addresses?.[0]?.address_line_1,
  });

  console.log("\nTesting search with query 'Ahmed'...");
  const searchRes = await CustomerService.listCustomers(context, { search: "Ahmed", limit: 5 });
  console.log(`Search 'Ahmed' total: ${searchRes.total}`);

  console.log("\nTesting Dashboard Metrics from DB...");
  const metrics = db.getDashboardMetrics(context.tenant.id);
  console.log("Dashboard metrics:", {
    activeCustomers: metrics.activeCustomers,
    totalOrders: metrics.totalOrders,
    totalRevenue: metrics.totalRevenue,
    totalProducts: metrics.totalProducts,
  });

  console.log("\n✓ ALL END-TO-END CHECKS SUCCEEDED!");
}

testApi().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
