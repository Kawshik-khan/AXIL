import type { ConnectorProviderDefinition } from "@/types/connector";

/**
 * Provider manifests, category PAYMENTS (goal GET_PAID). These gateways take money from the shop's customers through the
 * shop's own merchant account (ADR-123). Their credentials are owned by the Payments page (`PaymentSettingsService`,
 * encrypted, `settings.update` + step-up), so the manifest carries no fields and `managed_at` sends the merchant there;
 * the connectors routes refuse to save or test them.
 */
export const PAYMENTS_MANIFESTS: ConnectorProviderDefinition[] = [
  {
    id: "bkash",
    name: "bKash Checkout",
    category: "PAYMENTS",
    goal: "GET_PAID",
    status: "BETA",
    capabilities: ["PAYMENT"],
    auth_method: "api_key",
    resource_kinds: [],
    badge: "🇧🇩 Mobile wallet",
    description:
      "Customers pay a payment link with their own bKash number and PIN through your bKash merchant (PGW) account. The order is marked paid only after bKash confirms the payment.",
    portal_url: "https://pgw-integration.bkash.com",
    documentation_url: "https://developer.bka.sh/docs/tokenized-without-agreement",
    managed_at: "/payments",
    fields: [],
    guidelines: {
      portal_url: "https://pgw-integration.bkash.com",
      prerequisites: [
        "A bKash merchant account with Payment Gateway (Tokenized Checkout) enabled.",
        "Sandbox credentials from bKash to test first; live credentials once bKash approves your integration.",
      ],
      steps: [
        "Ask bKash for your Tokenized Checkout credentials: username, password, app key and app secret.",
        "Open Payments in CommerceOS and find the bKash checkout card.",
        "Paste the four credentials, keep Mode on Sandbox, switch on “Offer bKash on payment links” and save (you'll be asked for your authenticator code).",
        "Send yourself a payment link and pay it with a bKash sandbox wallet to check the flow.",
        "When bKash gives you live credentials, save them with Mode set to Live.",
      ],
      tips: [
        "Credentials are stored encrypted and never shown again; leave the fields empty to keep the saved ones.",
        "No webhook to configure: bKash returns the customer to CommerceOS, which then asks bKash to execute and confirm the payment.",
        "Live mode also needs the production URL bKash issues, set by the platform operator (BKASH_LIVE_BASE_URL).",
      ],
    },
  },
];
