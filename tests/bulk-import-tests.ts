// @ts-ignore
import assert from "assert";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { CsvParser } from "@/lib/csv-parser";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}

export async function runBulkImportTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS: BULK CATALOG IMPORT TEST SUITE       ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();

  // Provision test tenant workspace
  const now = Date.now();
  const testTenant = await AuthService.registerTenantWithOwner({
    workspaceName: `Dhaka Silk Traders ${now}`,
    name: "Tanvir Ahmed",
    email: `tanvir-${now}@dhakasilk.com`,
    password: "Password2026!",
    currency: "BDT",
  });

  const context: RequestContext = {
    requestId: `req_${now}`,
    traceId: `trc_${now}`,
    user: {
      id: testTenant.user.id,
      email: testTenant.user.email,
      name: testTenant.user.name,
      status: "ACTIVE",
    },
    tenant: {
      id: testTenant.tenant.id,
      name: testTenant.tenant.name,
      slug: testTenant.tenant.slug,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      status: "ACTIVE",
    },
    role: "OWNER",
    permissions: [
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.PRODUCTS_WRITE,
      PERMISSIONS.PRODUCTS_CREATE,
      PERMISSIONS.PRODUCTS_UPDATE,
      PERMISSIONS.INVENTORY_READ,
      PERMISSIONS.INVENTORY_ADJUST,
    ],
  };

  // Ensure a warehouse exists for tenant
  const warehouse = db.data.warehouses.find((w) => w.tenant_id === context.tenant.id) || {
    id: `wh_dhaka_${now}`,
    tenant_id: context.tenant.id,
    name: "Dhaka Central Hub",
    code: "WH-DHK-01",
    address: "Tejgaon Industrial Area",
    city: "Dhaka",
    district: "Dhaka",
    status: "ACTIVE" as const,
    created_at: new Date().toISOString(),
  };
  if (!db.data.warehouses.some((w) => w.id === warehouse.id)) {
    db.data.warehouses.push(warehouse);
  }

  // ----------------------------------------------------
  // TEST 1: CSV Parser RFC-4180 Compliance
  // ----------------------------------------------------
  await runTest("CSV Parser handles quotes, commas, multiline values and CRLF", () => {
    const rawCsv = [
      'Title,SKU,Price,Description',
      '"Silk Kurti, Red",SKU-KRT-01,1500,"Handcrafted with\r\nintricate resham work"',
      '"Men\'s ""Royal"" Panjabi",SKU-PNJ-02,2200,"Premium 100% cotton"',
    ].join('\r\n');

    const parsed = CsvParser.parse(rawCsv);
    assert.strictEqual(parsed.rows.length, 2);
    assert.strictEqual(parsed.rows[0].title, "Silk Kurti, Red");
    assert.strictEqual(parsed.rows[0].sku, "SKU-KRT-01");
    assert.strictEqual(parsed.rows[0].base_price, "1500");
    assert.ok(parsed.rows[0].description.includes("intricate resham work"));
    assert.strictEqual(parsed.rows[1].title, 'Men\'s "Royal" Panjabi');
    assert.strictEqual(parsed.rows[1].sku, "SKU-PNJ-02");
  });

  // ----------------------------------------------------
  // TEST 2: Header Normalization
  // ----------------------------------------------------
  await runTest("CSV Parser normalizes various spreadsheet column names", () => {
    assert.strictEqual(CsvParser.normalizeHeader("Product Name"), "title");
    assert.strictEqual(CsvParser.normalizeHeader("Item Code"), "sku");
    assert.strictEqual(CsvParser.normalizeHeader("Selling Price"), "base_price");
    assert.strictEqual(CsvParser.normalizeHeader("Initial Stock"), "stock");
    assert.strictEqual(CsvParser.normalizeHeader("Category Name"), "category");
    assert.strictEqual(CsvParser.normalizeHeader("Image URLs"), "images");
  });

  // ----------------------------------------------------
  // TEST 3: Valid Batch Ingestion with Inventory Ledger
  // ----------------------------------------------------
  await runTest("BulkImportService ingests valid product batch and initializes inventory", async () => {
    const rows = [
      {
        title: "Aarong Style Cotton Panjabi",
        sku: "SKU-TEST-001",
        base_price: 1850,
        compare_at_price: 2200,
        cost_price: 1100,
        stock: 35,
        category: "Men's Ethnic",
        description: "Comfortable Eid ethnic wear",
      },
      {
        title: "Traditional Dhakai Jamdani",
        sku: "SKU-TEST-002",
        base_price: 4500,
        compare_at_price: 5000,
        cost_price: 3000,
        stock: 12,
        category: "Women's Sarees",
        description: "Authentic handloom Jamdani",
      },
    ];

    const result = await ProductService.bulkImportProducts(context, rows, {
      mode: "upsert",
      auto_create_categories: true,
    });

    assert.strictEqual(result.total_rows, 2);
    assert.strictEqual(result.imported_count, 2);
    assert.strictEqual(result.updated_count, 0);
    assert.strictEqual(result.failed_count, 0);
    assert.strictEqual(result.errors.length, 0);
    assert.ok(result.successful_skus.includes("SKU-TEST-001"));
    assert.ok(result.successful_skus.includes("SKU-TEST-002"));

    // Verify database record
    const prod1 = db.findProductBySku(context.tenant.id, "SKU-TEST-001");
    assert.ok(prod1);
    assert.strictEqual(prod1.base_price, 1850);
    assert.strictEqual(prod1.name, "Aarong Style Cotton Panjabi");

    // Verify inventory initialization
    const variant1 = db.data.product_variants.find((v) => v.product_id === prod1.id);
    assert.ok(variant1);
    const inv1 = db.data.inventory_items.find(
      (i) => i.product_variant_id === variant1.id && i.tenant_id === context.tenant.id
    );
    assert.ok(inv1);
    assert.strictEqual(inv1.quantity_on_hand, 35);
    assert.strictEqual(inv1.quantity_available, 35);
  });

  // ----------------------------------------------------
  // TEST 4: Partial Failure Tolerance
  // ----------------------------------------------------
  await runTest("BulkImportService isolates row failures without blocking valid rows", async () => {
    const rows = [
      {
        title: "Valid Product Alpha",
        sku: "SKU-VAL-01",
        base_price: 950,
        stock: 20,
      },
      {
        title: "Invalid Negative Price",
        sku: "SKU-INV-01",
        base_price: -450, // Invalid: negative price
        stock: 10,
      },
      {
        title: "", // Invalid: empty title
        sku: "SKU-INV-02",
        base_price: 1200,
        stock: 5,
      },
      {
        title: "Valid Product Beta",
        sku: "SKU-VAL-02",
        base_price: 1350,
        stock: 15,
      },
      {
        title: "Duplicate SKU In Batch",
        sku: "SKU-VAL-01", // Duplicate within batch!
        base_price: 950,
        stock: 5,
      },
    ];

    const result = await ProductService.bulkImportProducts(context, rows, {
      mode: "upsert",
    });

    assert.strictEqual(result.total_rows, 5);
    assert.strictEqual(result.imported_count, 2); // SKU-VAL-01 and SKU-VAL-02
    assert.strictEqual(result.failed_count, 3);
    assert.strictEqual(result.errors.length, 3);

    // Verify error details
    const row2Error = result.errors.find((e) => e.row_index === 2);
    assert.ok(row2Error);
    assert.strictEqual(row2Error.field, "base_price");

    const row3Error = result.errors.find((e) => e.row_index === 3);
    assert.ok(row3Error);
    assert.strictEqual(row3Error.field, "title");

    const row5Error = result.errors.find((e) => e.row_index === 5);
    assert.ok(row5Error);
    assert.strictEqual(row5Error.field, "sku");
    assert.ok(row5Error.reason.includes("Duplicate SKU"));

    // Verify valid rows exist in catalog
    assert.ok(db.findProductBySku(context.tenant.id, "SKU-VAL-01"));
    assert.ok(db.findProductBySku(context.tenant.id, "SKU-VAL-02"));
    assert.strictEqual(db.findProductBySku(context.tenant.id, "SKU-INV-01"), undefined);
  });

  // ----------------------------------------------------
  // TEST 5: Option A Category Auto-Creation
  // ----------------------------------------------------
  await runTest("BulkImportService auto-provisions new categories (Option A)", async () => {
    const newCategoryName = `Exclusive Eid Collection ${Date.now()}`;
    const rows = [
      {
        title: "Luxury Embroidered Sherwani",
        sku: "SKU-SHER-999",
        base_price: 12500,
        stock: 5,
        category: newCategoryName,
      },
    ];

    const result = await ProductService.bulkImportProducts(context, rows, {
      mode: "upsert",
      auto_create_categories: true,
    });

    assert.strictEqual(result.imported_count, 1);
    assert.ok(result.created_categories.includes(newCategoryName));

    const savedProd = db.findProductBySku(context.tenant.id, "SKU-SHER-999");
    assert.ok(savedProd);
    assert.ok(savedProd.category_id);

    const savedCategory = db.data.categories.find(
      (c) => c.id === savedProd.category_id && c.tenant_id === context.tenant.id
    );
    assert.ok(savedCategory);
    assert.strictEqual(savedCategory.name, newCategoryName);
  });

  // ----------------------------------------------------
  // TEST 6: Upsert vs Create-Only Modes
  // ----------------------------------------------------
  await runTest("BulkImportService respects upsert vs create_only constraints", async () => {
    // 1. Update existing product in upsert mode
    const updateRows = [
      {
        title: "Aarong Style Cotton Panjabi - Updated",
        sku: "SKU-TEST-001", // already created in Test 3
        base_price: 1999,
        stock: 50,
      },
    ];

    const upsertResult = await ProductService.bulkImportProducts(context, updateRows, {
      mode: "upsert",
    });
    assert.strictEqual(upsertResult.updated_count, 1);
    assert.strictEqual(upsertResult.imported_count, 0);

    const updatedProd = db.findProductBySku(context.tenant.id, "SKU-TEST-001");
    assert.strictEqual(updatedProd?.base_price, 1999);
    assert.strictEqual(updatedProd?.name, "Aarong Style Cotton Panjabi - Updated");

    // 2. Reject existing product in create_only mode
    const createOnlyResult = await ProductService.bulkImportProducts(context, updateRows, {
      mode: "create_only",
    });
    assert.strictEqual(createOnlyResult.imported_count, 0);
    assert.strictEqual(createOnlyResult.updated_count, 0);
    assert.strictEqual(createOnlyResult.failed_count, 1);
    assert.ok(createOnlyResult.errors[0].reason.includes("create_only"));
  });

  // ----------------------------------------------------
  // TEST 7: Banglish and Currency Sanitization
  // ----------------------------------------------------
  await runTest("BulkImportService sanitizes currency symbols (৳, BDT) and comma separators", async () => {
    const rawRows = [
      {
        Title: "Premium Polo Shirt",
        SKU: "SKU-POLO-88",
        Price: "৳ 1,250",
        ComparePrice: "1,500 BDT",
        Stock: "25 pcs",
      },
    ];

    const result = await ProductService.bulkImportProducts(context, rawRows, {
      mode: "upsert",
    });

    assert.strictEqual(result.imported_count, 1);
    const prod = db.findProductBySku(context.tenant.id, "SKU-POLO-88");
    assert.strictEqual(prod?.base_price, 1250);
    assert.strictEqual(prod?.compare_at_price, 1500);
  });

  // ----------------------------------------------------
  // TEST 8: GET /api/v1/products/template Route
  // ----------------------------------------------------
  await runTest("GET /api/v1/products/template serves RFC-4180 CSV template", async () => {
    const { GET: getTemplate } = await import("@/app/api/v1/products/template/route");
    const response = await getTemplate();

    assert.strictEqual(response.status, 200);
    assert.ok(response.headers.get("Content-Type")?.includes("text/csv"));
    assert.ok(response.headers.get("Content-Disposition")?.includes("commerceos-product-import-template.csv"));

    const text = await response.text();
    const parsed = CsvParser.parse(text);
    assert.ok(parsed.rows.length >= 3);
    assert.ok(parsed.headers.includes("title"));
    assert.ok(parsed.headers.includes("sku"));
    assert.ok(parsed.headers.includes("base_price"));
  });

  // ----------------------------------------------------
  // TEST 9: POST /api/v1/products/bulk Route via HTTP Request
  // ----------------------------------------------------
  await runTest("POST /api/v1/products/bulk endpoint parses CSV and ingests products", async () => {
    const { POST: postBulk } = await import("@/app/api/v1/products/bulk/route");
    const { signSessionToken } = await import("@/lib/security");

    const token = await signSessionToken({
      userId: testTenant.user.id,
      tenantId: testTenant.tenant.id,
      role: "OWNER",
      email: testTenant.user.email,
      name: testTenant.user.name,
    });

    const csvPayload = [
      "Title,SKU,Price,Stock,Category",
      "Dhaka Muslin Dupatta,SKU-DPT-101,1450,20,Women's Ethnic",
      "Organic Linen Fotua,SKU-FTU-102,1100,30,Men's Ethnic",
    ].join("\r\n");

    const request = new Request("http://localhost:3000/api/v1/products/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "text/csv",
        Authorization: `Bearer ${token}`,
        "X-Tenant-ID": testTenant.tenant.id,
      },
      body: csvPayload,
    });

    const response = await postBulk(request);
    assert.strictEqual(response.status, 200);

    const json = await response.json();
    assert.strictEqual(json.data.imported_count, 2);
    assert.strictEqual(json.data.failed_count, 0);

    const muslinProd = db.findProductBySku(testTenant.tenant.id, "SKU-DPT-101");
    assert.ok(muslinProd);
    assert.strictEqual(muslinProd.base_price, 1450);
  });

  // ----------------------------------------------------
  // TEST SUMMARY
  // ----------------------------------------------------
  console.log(`\n${ANSI_BOLD}----------------------------------------------------${ANSI_RESET}`);
  console.log(`Tests Completed: ${passedCount + failedCount} | Passed: ${ANSI_GREEN}${passedCount}${ANSI_RESET} | Failed: ${failedCount > 0 ? ANSI_RED : ""}${failedCount}${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

if (require.main === module || !process.env.TEST_SUITE_RUNNER) {
  runBulkImportTests().catch((err) => {
    console.error("Test runner encountered an error:", err);
    process.exit(1);
  });
}
