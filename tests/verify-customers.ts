import { db } from "@/infrastructure/db";

async function verify() {
  console.log("\n========================================================");
  console.log("   COMMERCEOS 1,000 CUSTOMERS DATABASE SEED VERIFICATION ");
  console.log("========================================================\n");

  const tenantId = "ten_default_dhaka";
  const { customers, total } = db.getCustomers(tenantId, { limit: 10, offset: 0 });

  console.log(`[VERIFY] Total customers in tenant '${tenantId}': ${total}`);
  if (total < 1000) {
    throw new Error(`Expected at least 1000 customers, found ${total}`);
  }

  console.log("\n--- Sample Customer 1 ---");
  const first = customers[0];
  console.log(`ID: ${first.id}`);
  console.log(`Name: ${first.first_name} ${first.last_name}`);
  console.log(`Phone: ${first.phone}`);
  console.log(`Email: ${first.email}`);
  console.log(`Segment: ${(first as any).segment || 'N/A'}`);
  console.log(`Total Orders: ${first.total_orders}`);
  console.log(`Total Spent: ${first.total_spent} BDT`);
  console.log(`Addresses: ${first.addresses?.length || 0}`);
  if (first.addresses && first.addresses[0]) {
    const addr = first.addresses[0];
    console.log(`  Default Address: ${addr.address_line_1}, ${addr.district}, ${addr.division} ${addr.postal_code}`);
  }

  console.log("\n--- Sample Customer 2 ---");
  const second = customers[1];
  console.log(`ID: ${second.id}`);
  console.log(`Name: ${second.first_name} ${second.last_name}`);
  console.log(`Phone: ${second.phone}`);
  console.log(`Addresses: ${second.addresses?.length || 0}`);

  // Test pagination
  const page2 = db.getCustomers(tenantId, { limit: 10, offset: 10 });
  console.log(`\n[VERIFY] Pagination offset=10 limit=10 returned: ${page2.customers.length} records.`);

  // Test search
  const searchResult = db.getCustomers(tenantId, { search: "Rahman" });
  console.log(`[VERIFY] Search 'Rahman' returned: ${searchResult.total} matching records.`);

  // Verify all customers have addresses
  const allResult = db.getCustomers(tenantId, { limit: 2000, offset: 0 });
  let missingAddresses = 0;
  let missingPhones = 0;
  const divisions: Record<string, number> = {};

  for (const c of allResult.customers) {
    if (!c.phone || !c.phone.startsWith("+8801")) {
      missingPhones++;
    }
    if (!c.addresses || c.addresses.length === 0) {
      missingAddresses++;
    } else {
      const div = c.addresses[0].division || "Unknown";
      divisions[div] = (divisions[div] || 0) + 1;
    }
  }

  console.log(`[VERIFY] Invalid Phone Numbers: ${missingPhones}`);
  console.log(`[VERIFY] Missing Addresses: ${missingAddresses}`);
  console.log(`[VERIFY] Geographic Distribution across Bangladesh:`);
  for (const [div, count] of Object.entries(divisions)) {
    console.log(`  • ${div.padEnd(14)}: ${count} customers`);
  }

  console.log("\n========================================================");
  console.log("   ✓ VERIFICATION SUCCESSFUL: 1,000+ CUSTOMERS CONFIRMED");
  console.log("========================================================\n");
}

verify().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
