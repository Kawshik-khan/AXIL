import type { ConnectorProviderDefinition } from "@/types/connector";

/**
 * Provider manifests, category LOGISTICS. A manifest describes a provider (fields, guide, capabilities, status); behavior
 * belongs to its driver (connector plan, docs/connector-implementation-plan.md). Status: BETA = connectable and saved
 * encrypted, with a live credential check where one exists; COMING_SOON = listed but not connectable.
 */
export const LOGISTICS_MANIFESTS: ConnectorProviderDefinition[] = [
  {
    id: "steadfast",
    name: "Steadfast Courier",
    category: "LOGISTICS",
    status: "BETA",
    capabilities: ["COURIER"],
    badge: "🇧🇩 Nationwide COD #1",
    description: "Bangladesh's leading cash-on-delivery courier with full coverage across all 64 districts, automated parcel booking, and return reconciliation.",
    default_endpoint: "https://portal.steadfast.com.bd/api/v1",
    portal_url: "https://portal.steadfast.com.bd",
    documentation_url: "https://portal.steadfast.com.bd/developer-api",
    fields: [
      { name: "api_key", label: "Steadfast API Key", type: "password", required: true, placeholder: "Enter API Key from Steadfast portal" },
      { name: "secret_key", label: "Steadfast Secret Key", type: "password", required: true, placeholder: "Enter Secret Key from Steadfast portal" },
      { name: "webhook_secret", label: "Webhook Signing Secret (Optional)", type: "password", required: false, placeholder: "For verifying tracking status callbacks" },
      { name: "delivery_charge_inside_dhaka", label: "Inside Dhaka Delivery Charge (BDT)", type: "number", required: true, defaultValue: 60 },
      { name: "delivery_charge_outside_dhaka", label: "Outside Dhaka Delivery Charge (BDT)", type: "number", required: true, defaultValue: 120 },
    ],
    guidelines: {
      portal_url: "https://portal.steadfast.com.bd",
      prerequisites: [
        "An active Steadfast merchant account.",
        "Merchant pickup address registered in Steadfast dashboard.",
      ],
      steps: [
        "Log into https://portal.steadfast.com.bd.",
        "Navigate to Settings > API Settings (or Developer API tab).",
        "Generate your API Key and Secret Key.",
        "Paste them into CommerceOS.",
        "Under Steadfast Webhooks, configure the webhook URL provided below to receive real-time parcel delivery updates.",
      ],
      webhook_info: "/api/v1/automation/webhooks/steadfast?wh=<webhook-id>", // signed endpoint (FX-06, FX-33)
      tips: [
        "Steadfast status transitions (PENDING -> IN_TRANSIT -> DELIVERED) automatically mark COD orders as PAID in CommerceOS.",
      ],
    },
  },
  {
    id: "pathao",
    name: "Pathao Courier",
    category: "LOGISTICS",
    status: "BETA",
    capabilities: ["COURIER"],
    badge: "🇧🇩 Same-Day Express",
    description: "Rapid intra-city same-day dispatch in Dhaka and Chittagong with OAuth2 automated token management and on-demand rider dispatch.",
    default_endpoint: "https://api-hermes.pathao.com",
    portal_url: "https://merchant.pathao.com",
    documentation_url: "https://merchant.pathao.com/developers",
    fields: [
      { name: "client_id", label: "Client ID", type: "text", required: true, placeholder: "Pathao OAuth Client ID" },
      { name: "client_secret", label: "Client Secret", type: "password", required: true, placeholder: "Pathao OAuth Client Secret" },
      { name: "username", label: "Merchant Username (Email)", type: "text", required: true, placeholder: "merchant@business.com" },
      { name: "password", label: "Merchant Password", type: "password", required: true, placeholder: "••••••••" },
      { name: "store_id", label: "Pathao Store ID", type: "text", required: true, placeholder: "e.g. 12345" },
      { name: "environment", label: "Environment Mode", type: "select", required: true, defaultValue: "PRODUCTION", options: [
        { label: "Production (Live Hermes API)", value: "PRODUCTION" },
        { label: "Sandbox (Staging Test API)", value: "SANDBOX" },
      ]},
    ],
    guidelines: {
      portal_url: "https://merchant.pathao.com",
      prerequisites: ["Approved Pathao Courier merchant account with verified Store ID."],
      steps: [
        "Log into Pathao Merchant Panel at https://merchant.pathao.com.",
        "Go to Developer API section and create an API client application.",
        "Copy Client ID and Client Secret.",
        "Find your Store ID under Store Settings.",
        "Enter your Pathao merchant login credentials to enable automated token refreshes.",
      ],
      webhook_info: "/api/v1/automation/webhooks/pathao?wh=<webhook-id>", // signed endpoint (FX-06, FX-33)
    },
  },
  {
    id: "redx",
    name: "RedX Logistics",
    category: "LOGISTICS",
    status: "COMING_SOON",
    capabilities: [],
    badge: "🇧🇩 Nationwide Delivery",
    description: "Nationwide parcel pickup and automated delivery tracking with cash-on-delivery reconciliation.",
    default_endpoint: "https://openapi.redx.com.bd/v1.0.0-beta",
    portal_url: "https://redx.com.bd",
    documentation_url: "https://openapi.redx.com.bd/docs",
    fields: [
      { name: "access_token", label: "RedX Access Token", type: "password", required: true, placeholder: "Bearer token from RedX dashboard" },
      { name: "store_id", label: "RedX Store ID", type: "text", required: true, placeholder: "e.g. 54321" },
      { name: "environment", label: "Environment Mode", type: "select", required: true, defaultValue: "PRODUCTION", options: [
        { label: "Production", value: "PRODUCTION" },
        { label: "Sandbox", value: "SANDBOX" },
      ]},
    ],
    guidelines: {
      portal_url: "https://redx.com.bd",
      prerequisites: ["RedX merchant account."],
      steps: [
        "Visit RedX merchant dashboard at https://redx.com.bd.",
        "Navigate to Profile > Developer API.",
        "Generate and copy your Access Token.",
      ],
      webhook_info: "/api/v1/automation/webhooks/redx?wh=<webhook-id>", // signed endpoint (FX-06, FX-33)
    },
  },
  {
    id: "paperfly",
    name: "Paperfly Courier",
    category: "LOGISTICS",
    status: "COMING_SOON",
    capabilities: [],
    badge: "🇧🇩 Doorstep Logistics",
    description: "Extensive doorstep delivery network across upazilas in Bangladesh.",
    portal_url: "https://paperfly.com.bd",
    documentation_url: "https://paperfly.com.bd",
    fields: [
      { name: "username", label: "Paperfly Username", type: "text", required: true, placeholder: "Merchant User" },
      { name: "password", label: "Paperfly Password", type: "password", required: true, placeholder: "••••••••" },
      { name: "paperfly_key", label: "Paperfly Key", type: "password", required: true, placeholder: "Secret key" },
    ],
    guidelines: {
      portal_url: "https://paperfly.com.bd",
      prerequisites: ["Paperfly merchant agreement."],
      steps: ["Contact Paperfly enterprise support to obtain API access credentials."],
    },
  },
  {
    id: "ecourier",
    name: "eCourier",
    category: "LOGISTICS",
    status: "COMING_SOON",
    capabilities: [],
    badge: "🇧🇩 Automated Logistics",
    description: "Person-to-person and merchant parcel dispatch with automated tracking numbers.",
    portal_url: "https://ecourier.com.bd",
    documentation_url: "https://ecourier.com.bd",
    fields: [
      { name: "api_key", label: "eCourier API Key", type: "password", required: true, placeholder: "API Key" },
      { name: "api_secret", label: "eCourier API Secret", type: "password", required: true, placeholder: "API Secret" },
      { name: "user_id", label: "User ID", type: "text", required: true, placeholder: "Merchant ID" },
    ],
    guidelines: {
      portal_url: "https://ecourier.com.bd",
      prerequisites: ["eCourier merchant account."],
      steps: ["Obtain API Key, API Secret, and User ID from the eCourier merchant portal."],
    },
  },
  {
    id: "dhl_express",
    name: "DHL Express",
    category: "LOGISTICS",
    status: "COMING_SOON",
    capabilities: [],
    badge: "International Shipping",
    description: "Cross-border international parcel dispatch, commercial invoicing, and global courier tracking.",
    portal_url: "https://developer.dhl.com",
    documentation_url: "https://developer.dhl.com/api-reference/dhl-express-mydhl-api",
    fields: [
      { name: "account_number", label: "DHL Account Number", type: "text", required: true, placeholder: "9-digit DHL Account" },
      { name: "api_key", label: "API Key", type: "password", required: true, placeholder: "DHL MyDHL API Key" },
      { name: "api_secret", label: "API Secret", type: "password", required: true, placeholder: "••••••••" },
    ],
    guidelines: {
      portal_url: "https://developer.dhl.com",
      prerequisites: ["Active DHL Express corporate shipping account."],
      steps: ["Register application on https://developer.dhl.com to receive API Key and Secret."],
    },
  },
];
