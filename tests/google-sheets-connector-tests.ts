// @ts-ignore
import assert from "assert";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ConnectorService } from "@/domains/connectors/service";
import { GoogleSheetHelper } from "@/lib/google-sheet";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { BadRequestError } from "@/lib/errors";

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

export async function runGoogleSheetsTests() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS: GOOGLE SHEETS CONNECTOR TEST SUITE   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  // Provision test tenant
  const now = Date.now();
  const testTenant = await AuthService.registerTenantWithOwner({
    workspaceName: `Google Sheets Test Store ${now}`,
    name: "Sheet Manager",
    email: `sheet-${now}@teststore.com`,
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
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_UPDATE,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.PRODUCTS_WRITE,
      PERMISSIONS.PRODUCTS_CREATE,
    ],
  };

  // ----------------------------------------------------
  // TEST 1: URL & ID Extraction
  // ----------------------------------------------------
  await runTest("GoogleSheetHelper extracts spreadsheet ID across diverse URL shapes", () => {
    const canonicalId = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

    // Standard edit URL with gid
    assert.strictEqual(
      GoogleSheetHelper.extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${canonicalId}/edit#gid=0`),
      canonicalId
    );

    // Published web export URL
    assert.strictEqual(
      GoogleSheetHelper.extractSpreadsheetId("https://docs.google.com/spreadsheets/d/e/2PACX-1vQTestPublished12345/pubhtml"),
      "2PACX-1vQTestPublished12345"
    );

    // URL without protocol
    assert.strictEqual(
      GoogleSheetHelper.extractSpreadsheetId(`docs.google.com/spreadsheets/d/${canonicalId}/view`),
      canonicalId
    );

    // Raw alphanumeric ID
    assert.strictEqual(
      GoogleSheetHelper.extractSpreadsheetId(canonicalId),
      canonicalId
    );

    // Invalid string should throw BadRequestError
    assert.throws(() => {
      GoogleSheetHelper.extractSpreadsheetId("https://google.com/search?q=hello");
    }, BadRequestError);
  });

  // ----------------------------------------------------
  // TEST 2: GID Extraction & CSV Endpoint Formatting
  // ----------------------------------------------------
  await runTest("GoogleSheetHelper builds valid CSV export endpoints", () => {
    const id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
    const urlWithGid = `https://docs.google.com/spreadsheets/d/${id}/edit#gid=123456789`;

    assert.strictEqual(GoogleSheetHelper.extractGid(urlWithGid), "123456789");

    const csvUrl = GoogleSheetHelper.buildGoogleSheetCsvUrl(id, "Winter Ethnic 2026");
    assert.ok(csvUrl.includes(`/d/${id}/gviz/tq?tqx=out:csv`));
    assert.ok(csvUrl.includes("sheet=Winter%20Ethnic%202026"));
  });

  // ----------------------------------------------------
  // TEST 3: Provider Registration in ConnectorService
  // ----------------------------------------------------
  await runTest("ConnectorService.PROVIDERS contains prov_google_sheets with complete specification", () => {
    const provider = ConnectorService.PROVIDERS.find((p) => p.id === "prov_google_sheets");
    assert.ok(provider, "prov_google_sheets must be registered in PROVIDERS");
    assert.strictEqual(provider.category, "ENTERPRISE");
    assert.strictEqual(provider.name, "Google Sheets (Catalog & Inventory)");

    const fieldNames = provider.fields.map((f) => f.name);
    assert.ok(fieldNames.includes("spreadsheet_url"));
    assert.ok(fieldNames.includes("sheet_name"));
    assert.ok(fieldNames.includes("api_key"));
    assert.ok(fieldNames.includes("sync_frequency_minutes"));

    assert.ok(provider.guidelines);
    assert.ok(provider.guidelines.steps.length >= 4);
  });

  // ----------------------------------------------------
  // TEST 4: Connector testConnection Handshake
  // ----------------------------------------------------
  await runTest("ConnectorService.testConnection validates Google Sheets link and configuration", async () => {
    // 1. Valid link test
    const validResult = await ConnectorService.testConnection(context, {
      provider_id: "prov_google_sheets",
      credentials: {
        spreadsheet_url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
        sheet_name: "Products",
        sync_frequency_minutes: 15,
      },
    });

    // The link is parsed, but the sheet isn't fetched: not verified (FX-31)
    assert.strictEqual(validResult.status, "NOT_VERIFIED");
    assert.strictEqual(validResult.success, false);
    assert.strictEqual(validResult.details?.spreadsheet_id, "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
    assert.strictEqual(validResult.details?.sheet_name, "Products");

    // 2. Missing URL test
    let threwError = false;
    try {
      await ConnectorService.testConnection(context, {
        provider_id: "prov_google_sheets",
        credentials: {
          sheet_name: "Products",
        },
      });
    } catch (err: any) {
      threwError = true;
      assert.ok(err.message.includes("Google Spreadsheet Link or ID is required"));
    }
    assert.strictEqual(threwError, true);
  });

  // ----------------------------------------------------
  // TEST 5: Sheet Fetch Proxy Route (POST /api/v1/products/sheet-fetch)
  // ----------------------------------------------------
  await runTest("POST /api/v1/products/sheet-fetch route validates inputs and responds with JSON", async () => {
    const { POST: postSheetFetch } = await import("@/app/api/v1/products/sheet-fetch/route");
    const { signSessionToken } = await import("@/lib/security");

    const token = await signSessionToken({
      userId: testTenant.user.id,
      tenantId: testTenant.tenant.id,
      role: "OWNER",
      email: testTenant.user.email,
      name: testTenant.user.name,
    });

    // 1. Request with empty spreadsheet_url
    const emptyReq = new Request("http://localhost:3000/api/v1/products/sheet-fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Tenant-ID": testTenant.tenant.id,
      },
      body: JSON.stringify({ spreadsheet_url: "" }),
    });

    const emptyRes = await postSheetFetch(emptyReq);
    assert.strictEqual(emptyRes.status, 400);

    const emptyJson = await emptyRes.json();
    assert.ok(emptyJson.error?.message.includes("required"));
  });

  // ----------------------------------------------------
  // TEST 6: Sheet Fetch with Configured Connector (Regression Test)
  // ----------------------------------------------------
  await runTest("POST /api/v1/products/sheet-fetch safely checks db.findConnectorByProvider without crashing", async () => {
    const { POST: postSheetFetch } = await import("@/app/api/v1/products/sheet-fetch/route");
    const { signSessionToken, encryptCredential } = await import("@/lib/security");

    const token = await signSessionToken({
      userId: testTenant.user.id,
      tenantId: testTenant.tenant.id,
      role: "OWNER",
      email: testTenant.user.email,
      name: testTenant.user.name,
    });

    // Save connector in db
    db.saveConnector({
      id: `conn_gs_${now}`,
      tenant_id: testTenant.tenant.id,
      provider_id: "prov_google_sheets",
      category: "ENTERPRISE",
      name: "Google Sheets",
      credentials_encrypted: encryptCredential({ api_key: "AIzaSyTestApiKeyMock" }),
      credentials_masked: { api_key: "AIza••••Mock" },
      configuration: { spreadsheet_url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit" },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Request with valid public test spreadsheet
    const req = new Request("http://localhost:3000/api/v1/products/sheet-fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Tenant-ID": testTenant.tenant.id,
      },
      body: JSON.stringify({
        spreadsheet_url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
      }),
    });

    const res = await postSheetFetch(req);
    // Should NOT be a 500 error!
    assert.notStrictEqual(res.status, 500);
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
  runGoogleSheetsTests().catch((err) => {
    console.error("Test runner encountered an error:", err);
    process.exit(1);
  });
}
