// @ts-ignore
import assert from "assert";
import { db } from "@/infrastructure/db";
import { ConnectorService } from "@/domains/connectors/service";
import { RequestContext } from "@/lib/context";
import { encryptCredential, decryptCredential, maskSecret } from "@/lib/security";
import { RoleName, ROLE_PERMISSIONS, Permission } from "@/lib/permissions";
import { ForbiddenError, BadRequestError } from "@/lib/errors";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";

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

function createMockContext(tenantId: string, role: RoleName = "OWNER"): RequestContext {
  const permissions: Permission[] = ROLE_PERMISSIONS[role] || [];
  return {
    requestId: `req_test_${Date.now()}`,
    tenant: {
      id: tenantId,
      name: `Tenant ${tenantId}`,
      slug: `slug-${tenantId}`,
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      settings: {},
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    user: {
      id: `usr_${tenantId}`,
      email: `admin@${tenantId}.com`,
      name: "Test Admin",
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    role,
    permissions,
    membership: {
      id: `mem_${tenantId}`,
      tenant_id: tenantId,
      user_id: `usr_${tenantId}`,
      role,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
console.log(`${ANSI_BOLD}   COMMERCEOS CONNECTOR HUB VERIFICATION SUITE       ${ANSI_RESET}`);
console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

async function main() {
  db.clearAllForTesting();

  // -------------------------------------------------------------
  // SUITE 1: CATALOG INTEGRITY & ALL 4 CATEGORIES
  // -------------------------------------------------------------
  console.log(`${ANSI_BOLD}[1] Provider Catalog & Specification Completeness${ANSI_RESET}`);

  await runTest("Catalog includes the categories that can work from a hosted service (AI, Vector DB, Social, Logistics, Enterprise)", () => {
    const providers = ConnectorService.PROVIDERS;
    assert.ok(providers.length >= 20, `Expected at least 20 providers, got ${providers.length}`);

    const categories = new Set(providers.map((p) => p.category));
    assert.ok(categories.has("AI_LLM"), "Missing AI_LLM category");
    assert.ok(categories.has("VECTOR_DB"), "Missing VECTOR_DB category");
    assert.ok(categories.has("SOCIAL_ADS"), "Missing SOCIAL_ADS category");
    assert.ok(categories.has("LOGISTICS"), "Missing LOGISTICS category");
    assert.ok(categories.has("ENTERPRISE"), "Missing ENTERPRISE category");
    // TCP-only providers (databases, Redis) were removed: a hosted service must not open tenant-chosen TCP connections
    assert.ok(!categories.has("DATABASE") && !categories.has("REDIS_CACHE"), "database and Redis connectors must not be listed");
  });

  await runTest("Vector Databases catalog has Qdrant; the other vector and TCP providers were removed", () => {
    const qdrant = ConnectorService.PROVIDERS.find((p) => p.id === "qdrant");
    assert.ok(qdrant, "Qdrant must exist");
    assert.strictEqual(qdrant.category, "VECTOR_DB");
    assert.ok(qdrant.fields.some((f) => f.name === "vector_dimension"));
    for (const removed of ["pinecone", "chromadb", "milvus", "pgvector_dedicated"]) {
      assert.ok(!ConnectorService.PROVIDERS.some((p) => p.id === removed), `${removed} must not be listed`);
    }
  });

  await runTest("Redis providers were removed from the catalog", () => {
    for (const removed of ["redis_self_hosted", "upstash_redis", "redis_cloud"]) {
      assert.ok(!ConnectorService.PROVIDERS.some((p) => p.id === removed), `${removed} must not be listed`);
    }
  });

  await runTest("Enterprise Systems catalog has SAP S/4HANA, NetSuite, Salesforce CRM, HubSpot CRM, Daraz Marketplace, and Shopify Plus", () => {
    const sap = ConnectorService.PROVIDERS.find((p) => p.id === "prov_sap_s4hana");
    assert.ok(sap, "SAP S/4HANA must exist");
    assert.strictEqual(sap.category, "ENTERPRISE");
    assert.ok(sap.fields.some((f) => f.name === "company_code"));

    const netsuite = ConnectorService.PROVIDERS.find((p) => p.id === "prov_oracle_netsuite");
    assert.ok(netsuite, "NetSuite must exist");
    assert.strictEqual(netsuite.category, "ENTERPRISE");

    const salesforce = ConnectorService.PROVIDERS.find((p) => p.id === "prov_salesforce_crm");
    assert.ok(salesforce, "Salesforce must exist");

    const hubspot = ConnectorService.PROVIDERS.find((p) => p.id === "prov_hubspot_crm");
    assert.ok(hubspot, "HubSpot must exist");

    const daraz = ConnectorService.PROVIDERS.find((p) => p.id === "prov_daraz_marketplace");
    assert.ok(daraz, "Daraz Marketplace must exist");
    assert.strictEqual(daraz.category, "ENTERPRISE");
    assert.ok(daraz.fields.some((f) => f.name === "country_code"));

    const shopify = ConnectorService.PROVIDERS.find((p) => p.id === "prov_shopify_plus");
    assert.ok(shopify, "Shopify Plus must exist");
  });

  await runTest("AI & LLM providers feature suggested latest models and endpoints", () => {
    const openai = ConnectorService.PROVIDERS.find((p) => p.id === "openai");
    assert.ok(openai, "OpenAI provider must exist");
    assert.ok(openai.suggested_models?.includes("gpt-4o"), "OpenAI must suggest gpt-4o");
    assert.ok(openai.suggested_models?.includes("gpt-4o-mini"), "OpenAI must suggest gpt-4o-mini");

    const anthropic = ConnectorService.PROVIDERS.find((p) => p.id === "anthropic");
    assert.ok(anthropic, "Anthropic Claude provider must exist");
    assert.ok(anthropic.suggested_models?.some((m) => m.includes("claude-3-7-sonnet")), "Claude must suggest Claude 3.7");

    const gemini = ConnectorService.PROVIDERS.find((p) => p.id === "google_gemini");
    assert.ok(gemini, "Gemini must exist");
    assert.ok(gemini.suggested_models?.includes("gemini-2.5-flash"), "Gemini must suggest 2.5 flash");

    const ollama = ConnectorService.PROVIDERS.find((p) => p.id === "ollama");
    assert.ok(ollama, "Ollama self-hosted provider must exist");
    assert.strictEqual(ollama.default_endpoint, "http://localhost:11434/v1");
  });

  await runTest("Bangladeshi Couriers catalog has Steadfast, Pathao, and RedX", () => {
    const steadfast = ConnectorService.PROVIDERS.find((p) => p.id === "steadfast");
    assert.ok(steadfast, "Steadfast courier must exist");
    assert.ok(steadfast.fields.some((f) => f.name === "api_key"), "Steadfast must have api_key field");
    assert.ok(steadfast.fields.some((f) => f.name === "secret_key"), "Steadfast must have secret_key field");

    const pathao = ConnectorService.PROVIDERS.find((p) => p.id === "pathao");
    assert.ok(pathao, "Pathao courier must exist");
    assert.ok(pathao.fields.some((f) => f.name === "client_id"), "Pathao must have client_id");
  });

  await runTest("Social & Messaging catalog includes Telegram Bot & Channels API", () => {
    const telegram = ConnectorService.PROVIDERS.find((p) => p.id === "telegram");
    assert.ok(telegram, "Telegram provider must exist");
    assert.strictEqual(telegram.category, "SOCIAL_ADS");
    assert.ok(telegram.fields.some((f) => f.name === "bot_token"), "Must have bot_token field");
    assert.ok(telegram.fields.some((f) => f.name === "bot_username"), "Must have bot_username field");
    assert.ok(telegram.fields.some((f) => f.name === "default_chat_id"), "Must have default_chat_id field");
    assert.strictEqual(telegram.guidelines?.webhook_info, undefined, "no Telegram receiver exists, so no URL is advertised (FX-33)");
  });

  // -------------------------------------------------------------
  // SUITE 2: SMART DATABASE URI PARSING
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[2] Smart Database URI Parser Tests${ANSI_RESET}`);

  await runTest("Parse Neon pooled connection URI into structured components", () => {
    const uri = "postgresql://neondb_owner:npg_SecretPass123@ep-cool-fog-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
    const parsed = ConnectorService.parseDatabaseUri(uri);

    assert.strictEqual(parsed.host, "ep-cool-fog-123-pooler.us-east-2.aws.neon.tech");
    assert.strictEqual(parsed.port, 5432);
    assert.strictEqual(parsed.database, "neondb");
    assert.strictEqual(parsed.username, "neondb_owner");
    assert.strictEqual(parsed.password, "npg_SecretPass123");
    assert.strictEqual(parsed.ssl_mode, "require");
  });

  await runTest("Parse Supabase pooler URI with port 6543", () => {
    const uri = "postgresql://postgres.xyzref:mySupabasePass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
    const parsed = ConnectorService.parseDatabaseUri(uri);

    assert.strictEqual(parsed.host, "aws-0-us-east-1.pooler.supabase.com");
    assert.strictEqual(parsed.port, 6543);
    assert.strictEqual(parsed.database, "postgres");
    assert.strictEqual(parsed.username, "postgres.xyzref");
    assert.strictEqual(parsed.password, "mySupabasePass");
  });

  await runTest("Parse Self-Hosted MySQL and Redis URIs", () => {
    const mysqlUri = "mysql://dbuser:mysqlpass@192.168.1.50:3306/production_db";
    const parsedMysql = ConnectorService.parseDatabaseUri(mysqlUri);
    assert.strictEqual(parsedMysql.host, "192.168.1.50");
    assert.strictEqual(parsedMysql.port, 3306);
    assert.strictEqual(parsedMysql.database, "production_db");
    assert.strictEqual(parsedMysql.username, "dbuser");

    const redisUri = "redis://:redispass@10.0.0.1:6379";
    const parsedRedis = ConnectorService.parseDatabaseUri(redisUri);
    assert.strictEqual(parsedRedis.host, "10.0.0.1");
    assert.strictEqual(parsedRedis.port, 6379);
    assert.strictEqual(parsedRedis.password, "redispass");
  });

  // -------------------------------------------------------------
  // SUITE 3: AES-256-GCM CREDENTIAL ENCRYPTION & MASKING
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[3] AES-256-GCM Credential Encryption & Masking Tests${ANSI_RESET}`);

  await runTest("Encrypt and decrypt credentials payload correctly", () => {
    const rawCredentials = {
      api_key: "sk-ant-api03-abcdef1234567890abcdef1234",
      secret_key: "my_very_confidential_webhook_secret",
      port: 5432,
    };

    const cipherText = encryptCredential(rawCredentials);
    assert.strictEqual(typeof cipherText, "string");
    assert.ok(cipherText.includes(":"), "Ciphertext must contain IV and AuthTag separated by colon");
    assert.ok(!cipherText.includes("sk-ant-"), "Raw secret must NEVER leak into ciphertext");

    const decrypted = decryptCredential<typeof rawCredentials>(cipherText);
    assert.deepStrictEqual(decrypted, rawCredentials);
  });

  await runTest("Mask sensitive secrets safely for client display", () => {
    const maskedApiKey = maskSecret("sk-proj-123456789abcdef1234");
    assert.strictEqual(maskedApiKey, "sk-p••••••••1234");

    const shortSecret = maskSecret("abc");
    assert.strictEqual(shortSecret, "••••••••");
  });

  // -------------------------------------------------------------
  // SUITE 4: CONNECTOR LIFECYCLE & MULTI-TENANT ISOLATION
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[4] Connector Configuration Lifecycle & Tenant Isolation${ANSI_RESET}`);

  const tenantAContext = createMockContext("tenant_alpha_01");
  const tenantBContext = createMockContext("tenant_beta_02");

  await runTest("Save OpenAI connector for Tenant A", async () => {
    const saved = await ConnectorService.saveConnector(tenantAContext, {
      provider_id: "openai",
      default_model: "gpt-4o",
      credentials: {
        api_key: "sk-proj-tenant-alpha-secret-key-1234",
        organization_id: "org-alpha-456",
      },
    });

    assert.ok(saved.id.startsWith("conn_openai_"));
    assert.strictEqual(saved.tenant_id, "tenant_alpha_01");
    assert.strictEqual(saved.status, "ACTIVE");
    assert.strictEqual(saved.default_model, "gpt-4o");
    assert.strictEqual(saved.credentials_masked.api_key, "sk-p••••••••1234");
    // Verify credentials_encrypted is NOT in the returned safe object
    assert.strictEqual((saved as any).credentials_encrypted, undefined);
  });

  await runTest("Verify strict tenant isolation: Tenant B cannot see Tenant A's connectors", async () => {
    const tenantAList = await ConnectorService.listConnectors(tenantAContext);
    assert.strictEqual(tenantAList.configurations.length, 1);
    assert.strictEqual(tenantAList.configurations[0].tenant_id, "tenant_alpha_01");

    const tenantBList = await ConnectorService.listConnectors(tenantBContext);
    assert.strictEqual(tenantBList.configurations.length, 0, "Tenant B must have 0 connectors configured");
  });

  await runTest("Save Steadfast Courier for Tenant B with delivery charges", async () => {
    const saved = await ConnectorService.saveConnector(tenantBContext, {
      provider_id: "steadfast",
      credentials: {
        api_key: "steadfast_api_key_beta_9999",
        secret_key: "steadfast_secret_key_beta_8888",
        delivery_charge_inside_dhaka: 60,
        delivery_charge_outside_dhaka: 120,
      },
    });

    assert.strictEqual(saved.tenant_id, "tenant_beta_02");
    assert.strictEqual(saved.provider_id, "steadfast");

    const tenantBList = await ConnectorService.listConnectors(tenantBContext);
    assert.strictEqual(tenantBList.configurations.length, 1);
    assert.strictEqual(tenantBList.configurations[0].provider_id, "steadfast");
  });

  await runTest("Update existing connector configuration", async () => {
    const updated = await ConnectorService.saveConnector(tenantAContext, {
      provider_id: "openai",
      default_model: "gpt-4o-mini",
      credentials: {
        api_key: "sk-proj-tenant-alpha-secret-key-UPDATED-9999",
      },
    });

    assert.strictEqual(updated.default_model, "gpt-4o-mini");
    assert.strictEqual(updated.credentials_masked.api_key, "sk-p••••••••9999");
  });

  // -------------------------------------------------------------
  // SUITE 5: REAL-TIME TEST CONNECTION HANDSHAKE
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[5] Real-Time Connection Test Handshake${ANSI_RESET}`);

  // Live checks go through the SSRF-guarded outbound client; its transport is stubbed (no network in tests, FX-53)
  const fetchCalls: string[] = [];
  let stubStatus = 200;
  let stubBody = "{}";
  setOutboundTransportForTesting(async (url) => {
    fetchCalls.push(url.toString());
    return { status: stubStatus, headers: {}, body: stubBody, truncated: false, durationMs: 12 };
  });

  await runTest("Test AI LLM connection handshake", async () => {
    const result = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "openai",
      default_model: "gpt-4o",
      credentials: {
        api_key: "sk-proj-valid-api-key-here-1234",
      },
    });

    // A real check against OpenAI's public endpoint (fetch stubbed here: no network in tests) (FX-31)
    assert.strictEqual(result.status, "VERIFIED");
    assert.strictEqual(result.success, true);
    assert.ok(typeof result.latency_ms === "number", "measured latency");
    assert.ok(result.message.includes("OpenAI"), "Message should mention provider");
    assert.deepStrictEqual(fetchCalls, ["https://api.openai.com/v1/models"]);

    stubStatus = 401;
    const refused = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "openai",
      credentials: { api_key: "sk-proj-wrong-key-0000" },
    });
    assert.strictEqual(refused.status, "FAILED");
    assert.strictEqual(refused.success, false);

    // A custom endpoint on a private or metadata address is refused before any request (SSRF guard)
    fetchCalls.length = 0;
    const custom = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "openai",
      endpoint_url: "http://169.254.169.254/latest",
      credentials: { api_key: "sk-proj-valid-api-key-here-1234" },
    });
    assert.strictEqual(custom.status, "FAILED");
    assert.strictEqual(custom.details?.reason, "BLOCKED_URL");
    assert.deepStrictEqual(fetchCalls, [], "no request to a private address");
    // A public custom base URL is checked for real
    stubStatus = 200;
    const gateway = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "openai",
      endpoint_url: "https://gateway.example.com/v1",
      credentials: { api_key: "sk-proj-valid-api-key-here-1234" },
    });
    assert.strictEqual(gateway.status, "VERIFIED");
    assert.deepStrictEqual(fetchCalls, ["https://gateway.example.com/v1/models"]);
    stubStatus = 200;
  });

  await runTest("Fail test AI LLM connection when required API key is missing", async () => {
    let threw = false;
    try {
      await ConnectorService.testConnection(tenantAContext, {
        provider_id: "anthropic",
        credentials: {},
      });
    } catch (err) {
      threw = true;
      assert.ok(err instanceof BadRequestError);
    }
    assert.strictEqual(threw, true, "Should throw BadRequestError on missing API key");
  });

  await runTest("A removed provider (Neon, Redis, Pinecone) can't be tested or saved: PROVIDER_NOT_SUPPORTED", async () => {
    for (const provider_id of ["neon", "redis_self_hosted", "pinecone"]) {
      await assert.rejects(
        () => ConnectorService.testConnection(tenantAContext, { provider_id, credentials: { connection_uri: "postgresql://u:p@host.example/db" } }),
        (err: unknown) => err instanceof BadRequestError && /PROVIDER_NOT_SUPPORTED/.test(err.message),
        provider_id
      );
      await assert.rejects(
        () => ConnectorService.saveConnector(tenantAContext, { provider_id, credentials: { connection_uri: "postgresql://u:p@host.example/db" } }),
        (err: unknown) => err instanceof BadRequestError && /PROVIDER_NOT_SUPPORTED/.test(err.message),
        provider_id
      );
    }
  });

  await runTest("A COMING_SOON provider (Pathao is BETA, RedX is not) is listed but can't be saved", async () => {
    const redx = ConnectorService.PROVIDERS.find((p) => p.id === "redx");
    assert.ok(redx && redx.status === "COMING_SOON");
    await assert.rejects(
      () => ConnectorService.saveConnector(tenantAContext, { provider_id: "redx", credentials: { api_key: "x" } }),
      (err: unknown) => err instanceof BadRequestError && /PROVIDER_NOT_AVAILABLE/.test(err.message)
    );
  });

  await runTest("Test Vector Database connection handshake for Qdrant and Pinecone", async () => {
    const qdrantResult = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "qdrant",
      endpoint_url: "http://localhost:6333",
      credentials: {
        collection_name: "test_products_vectors",
        vector_dimension: 1536,
      },
    });
    // A self-hosted server on localhost needs the platform allow-list; without it nothing is contacted
    assert.strictEqual(qdrantResult.status, "FAILED");
    assert.strictEqual(qdrantResult.details?.reason, "BLOCKED_URL");
    assert.ok(qdrantResult.message.includes("Qdrant"));

  });

  await runTest("Test Telegram Bot API connection handshake and missing token error", async () => {
    const validResult = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "telegram",
      credentials: {
        bot_token: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_012345",
        bot_username: "@CommerceOSStoreBot",
      },
    });
    // Telegram answers 200 with ok:false for a bad token: only ok:true verifies
    assert.strictEqual(validResult.status, "FAILED");
    assert.strictEqual(validResult.details?.reason, "UNAUTHORIZED");
    stubBody = '{"ok":true,"result":{"id":123456789,"is_bot":true}}';
    const okResult = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "telegram",
      credentials: { bot_token: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_012345" },
    });
    stubBody = "{}";
    assert.strictEqual(okResult.status, "VERIFIED");
    assert.ok(okResult.message.includes("Telegram"));

    let threw = false;
    try {
      await ConnectorService.testConnection(tenantAContext, {
        provider_id: "telegram",
        credentials: {},
      });
    } catch (err) {
      threw = true;
      assert.ok(err instanceof BadRequestError);
    }
    assert.strictEqual(threw, true, "Should fail when Telegram bot_token is missing");
  });

  await runTest("Enterprise provider without a live check (Google Sheets) is NOT_VERIFIED with no latency; SAP is coming soon", async () => {
    const sheetsTest = await ConnectorService.testConnection(tenantAContext, {
      provider_id: "prov_google_sheets",
      credentials: { spreadsheet_url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit", sheet_name: "Products" },
    });
    assert.strictEqual(sheetsTest.status, "NOT_VERIFIED");
    assert.strictEqual(sheetsTest.latency_ms, null);

    await assert.rejects(
      () => ConnectorService.testConnection(tenantAContext, { provider_id: "prov_sap_s4hana", credentials: { client_id: "SAP_COMM_USER" } }),
      (err: unknown) => err instanceof BadRequestError && /PROVIDER_NOT_AVAILABLE/.test(err.message)
    );
  });

  await runTest("Fail Enterprise handshake when credentials are empty", async () => {
    let threw = false;
    try {
      await ConnectorService.testConnection(tenantAContext, {
        provider_id: "prov_hubspot_crm",
        credentials: {},
      });
    } catch (err) {
      threw = true;
      assert.ok(err instanceof BadRequestError);
    }
    assert.strictEqual(threw, true, "Empty credentials must trigger BadRequestError");
  });

  // -------------------------------------------------------------
  // SUITE 6: RBAC & DELETE OPERATIONS
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[6] RBAC Access Control & Deletion Tests${ANSI_RESET}`);

  await runTest("Disallow non-admin/non-settings role from modifying connectors", async () => {
    const supportContext = createMockContext("tenant_alpha_01", "SUPPORT");
    let threw = false;
    try {
      await ConnectorService.saveConnector(supportContext, {
        provider_id: "openai",
        credentials: { api_key: "sk-test" },
      });
    } catch (err) {
      threw = true;
      assert.ok(err instanceof ForbiddenError);
    }
    assert.strictEqual(threw, true, "Support role must be blocked from saving connector");
  });

  await runTest("Delete / Disconnect a connector configuration", async () => {
    const listBefore = await ConnectorService.listConnectors(tenantAContext);
    const connId = listBefore.configurations[0].id;

    const deleted = await ConnectorService.deleteConnector(tenantAContext, connId);
    assert.strictEqual(deleted, true);

    const listAfter = await ConnectorService.listConnectors(tenantAContext);
    assert.strictEqual(listAfter.configurations.length, 0);
  });

  // -------------------------------------------------------------
  // SUITE 7: ENTERPRISE LIFECYCLE & INTEGRATIONS HUB SYNC
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[7] Enterprise Integration Lifecycle & Hub Synchronization${ANSI_RESET}`);

  await runTest("Save Enterprise connector and verify sync to db.data.integration_installations", async () => {
    const saved = await ConnectorService.saveConnector(tenantAContext, {
      provider_id: "prov_hubspot_crm",
      credentials: {
        access_token: "pat-na1-test-token-555",
        portal_id: "12345678",
        sync_frequency_minutes: 10,
      },
    });

    assert.strictEqual(saved.category, "ENTERPRISE");
    assert.strictEqual(saved.status, "ACTIVE");

    // Verify presence in db integration installations
    const installations = db.getIntegrationInstallations(tenantAContext.tenant.id);
    const hubspotInst = installations.find((i: any) => i.provider_id === "prov_hubspot_crm");
    assert.ok(hubspotInst, "Integration installation must be registered");
    assert.strictEqual(hubspotInst.status, "NOT_VERIFIED"); // saved, never checked with HubSpot (FX-31)
    assert.strictEqual(hubspotInst.sync_frequency_minutes, 10);

    // Delete Enterprise connector and verify marked DISCONNECTED
    const deleted = await ConnectorService.deleteConnector(tenantAContext, saved.id);
    assert.strictEqual(deleted, true);

    const updatedInst = db.getIntegrationInstallations(tenantAContext.tenant.id).find((i: any) => i.id === hubspotInst.id);
    assert.ok(updatedInst);
    assert.strictEqual(updatedInst.status, "DISCONNECTED");
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(
    `   ${ANSI_BOLD}CONNECTOR TEST SUMMARY: ${ANSI_GREEN}${passedCount} PASSED${ANSI_RESET}, ${
      failedCount > 0 ? ANSI_RED : ""
    }${failedCount} FAILED${ANSI_RESET}`
  );
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution aborted:", err);
  process.exit(1);
});
