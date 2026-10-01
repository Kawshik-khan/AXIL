import type { ConnectorProviderDefinition } from "@/types/connector";

/**
 * Provider manifests, category SOCIAL_ADS. A manifest describes a provider (fields, guide, capabilities, status); behavior
 * belongs to its driver (connector plan, docs/connector-implementation-plan.md). Status: BETA = connectable and saved
 * encrypted, with a live credential check where one exists; COMING_SOON = listed but not connectable.
 */
export const SOCIAL_ADS_MANIFESTS: ConnectorProviderDefinition[] = [
  {
    id: "meta_graph",
    name: "Meta Graph API (Facebook & Instagram)",
    category: "SOCIAL_ADS",
    status: "BETA",
    capabilities: ["MESSAGING"],
    badge: "Facebook + Instagram",
    description: "Direct two-way customer messaging via Facebook Messenger, Instagram Direct DMs, Page Comments, and Meta Catalog syncing.",
    portal_url: "https://developers.facebook.com/apps",
    documentation_url: "https://developers.facebook.com/docs/messenger-platform",
    fields: [
      { name: "app_id", label: "Meta App ID", type: "text", required: true, placeholder: "123456789012345" },
      { name: "app_secret", label: "Meta App Secret", type: "password", required: true, placeholder: "••••••••••••••••••••" },
      { name: "page_id", label: "Facebook Page ID", type: "text", required: true, placeholder: "10001234567890" },
      { name: "page_access_token", label: "Page Access Token (Never Expiring)", type: "password", required: true, placeholder: "EAAB..." },
      { name: "webhook_verify_token", label: "Webhook Verify Token", type: "password", required: true, placeholder: "Custom string for webhook handshake" },
    ],
    guidelines: {
      portal_url: "https://developers.facebook.com/apps",
      prerequisites: [
        "A Meta for Developers account.",
        "Admin access to your Facebook Page and connected Instagram Professional account.",
      ],
      steps: [
        "Go to https://developers.facebook.com/apps and create an App of type 'Business'.",
        "Add products: 'Messenger' and 'Instagram Graph API'.",
        "In App Settings > Basic, copy 'App ID' and 'App Secret'.",
        "Generate a never-expiring Page Access Token via Meta Graph API Explorer.",
        "In Messenger > Webhooks, set the Callback URL to your CommerceOS webhook and enter your Verify Token.",
        "Subscribe to events: messages, messaging_postbacks, message_reads, messaging_optins.",
      ],
      webhook_info: "/api/v1/social/webhooks/facebook", // Instagram: /instagram, WhatsApp: /whatsapp (FX-33)
      tips: [
        "Adhere strictly to the Meta 24-hour standard customer messaging window.",
        "CommerceOS auto-validates cryptographic HMAC-SHA256 headers on all inbound webhooks.",
      ],
    },
  },
  {
    id: "google_ads",
    name: "Google Ads & Conversion Tracking",
    category: "SOCIAL_ADS",
    status: "COMING_SOON",
    capabilities: [],
    badge: "Google Ads",
    description: "Offline conversion uploads, enhanced customer purchase tracking, and ad campaign attribution synchronization.",
    portal_url: "https://ads.google.com",
    documentation_url: "https://developers.google.com/google-ads/api/docs/first-call/overview",
    fields: [
      { name: "customer_id", label: "Google Ads Customer ID", type: "text", required: true, placeholder: "123-456-7890" },
      { name: "developer_token", label: "Developer Token", type: "password", required: true, placeholder: "••••••••••••" },
      { name: "client_id", label: "OAuth2 Client ID", type: "text", required: true, placeholder: "xyz.apps.googleusercontent.com" },
      { name: "client_secret", label: "OAuth2 Client Secret", type: "password", required: true, placeholder: "GOCSPX-..." },
      { name: "refresh_token", label: "OAuth2 Refresh Token", type: "password", required: true, placeholder: "1//04..." },
    ],
    guidelines: {
      portal_url: "https://ads.google.com",
      prerequisites: [
        "Google Ads Manager account with Basic or Standard developer token access.",
        "Google Cloud Console project with Google Ads API enabled.",
      ],
      steps: [
        "In Google Ads Manager, navigate to Tools & Settings > API Center and copy your Developer Token.",
        "In Google Cloud Console, create OAuth 2.0 Client Credentials (Web application).",
        "Authorize the redirect URI and obtain the Refresh Token using the OAuth Playground.",
        "Enter your 10-digit Customer ID without dashes or with dashes.",
      ],
    },
  },
  {
    id: "whatsapp_cloud",
    name: "WhatsApp Cloud API (Meta)",
    category: "SOCIAL_ADS",
    status: "BETA",
    capabilities: ["MESSAGING"],
    badge: "WhatsApp Business",
    description: "Direct official WhatsApp Business API for conversational commerce, interactive order confirmations, and COD validations.",
    portal_url: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    documentation_url: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    fields: [
      { name: "phone_number_id", label: "Phone Number ID", type: "text", required: true, placeholder: "10654321..." },
      { name: "waba_id", label: "WhatsApp Business Account ID (WABA ID)", type: "text", required: true, placeholder: "10987654..." },
      { name: "permanent_access_token", label: "Permanent Access Token (System User)", type: "password", required: true, placeholder: "EAAB..." },
      { name: "webhook_verify_token", label: "Webhook Verify Token", type: "password", required: true },
    ],
    guidelines: {
      portal_url: "https://developers.facebook.com/docs/whatsapp/cloud-api",
      prerequisites: [
        "A verified Meta Business Manager account.",
        "A dedicated phone number not tied to an existing personal WhatsApp app.",
      ],
      steps: [
        "Create a System User in Meta Business Settings and grant 'whatsapp_business_messaging' permissions.",
        "Generate a permanent token for the System User.",
        "In WhatsApp > API Setup, copy the Phone Number ID and WABA ID.",
        "Configure the webhook URL in CommerceOS with the verify token.",
      ],
      webhook_info: "/api/v1/social/webhooks/whatsapp",
    },
  },
  {
    id: "tiktok_shop",
    name: "TikTok Shop & Marketing API",
    category: "SOCIAL_ADS",
    status: "COMING_SOON",
    capabilities: [],
    badge: "TikTok Shop",
    description: "TikTok live commerce order ingestion, catalog publishing, and TikTok Pixel purchase conversion events.",
    portal_url: "https://partner.tiktokshop.com",
    documentation_url: "https://partner.tiktokshop.com/doc/page/63ff5a92d8f9ba0292ff2cfa",
    fields: [
      { name: "app_key", label: "TikTok App Key", type: "text", required: true, placeholder: "6a..." },
      { name: "app_secret", label: "TikTok App Secret", type: "password", required: true, placeholder: "••••••••" },
      { name: "access_token", label: "Authorized Access Token", type: "password", required: true, placeholder: "••••••••" },
      { name: "advertiser_id", label: "Advertiser ID (Optional)", type: "text", required: false, placeholder: "7123..." },
    ],
    guidelines: {
      portal_url: "https://partner.tiktokshop.com",
      prerequisites: ["TikTok Shop Partner / Developer Account."],
      steps: [
        "Create an app on TikTok Partner Portal.",
        "Complete merchant authorization to receive the Access Token.",
      ],
    },
  },
  {
    id: "telegram",
    name: "Telegram Bot & Channels API",
    category: "SOCIAL_ADS",
    status: "BETA",
    capabilities: ["MESSAGING"],
    badge: "Telegram Bot API",
    description: "Automated customer order invoices, instant checkout notifications, community broadcasts, and merchant VIP alerts via official Telegram Bot API.",
    portal_url: "https://t.me/botfather",
    documentation_url: "https://core.telegram.org/bots/api",
    fields: [
      { name: "bot_token", label: "Telegram Bot Token", type: "password", required: true, placeholder: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_012345", description: "API token issued by @BotFather on Telegram." },
      { name: "bot_username", label: "Bot Username (Optional)", type: "text", required: false, placeholder: "@MyStoreBot", description: "Public username of your Telegram Bot." },
      { name: "default_chat_id", label: "Default Chat / Channel ID (Optional)", type: "text", required: false, placeholder: "-1001234567890", description: "Telegram Channel or Group ID for receiving automated order & stock alerts." },
      { name: "webhook_secret", label: "Webhook Secret Token (Optional)", type: "password", required: false, placeholder: "Custom string for X-Telegram-Bot-Api-Secret-Token verification" },
    ],
    guidelines: {
      portal_url: "https://t.me/botfather",
      prerequisites: [
        "A Telegram account.",
        "Access to @BotFather bot on Telegram.",
      ],
      steps: [
        "Open Telegram and search for '@BotFather'.",
        "Send '/newbot' and follow instructions to specify a name and username ending in 'bot'.",
        "Copy the HTTP API access token and paste it into 'Telegram Bot Token' above.",
        "Optionally add your bot as an administrator to your store's private group or channel for automated dispatch notifications.",
        "Click 'Test Connection' to verify bot authorization.",
      ],
      // No Telegram webhook receiver exists, so no URL is advertised (FX-33)
      tips: [
        "Telegram allows zero per-message cost with markdown formatting.",
        "Supports inline keyboard buttons for instant order confirmations and shipment tracking.",
      ],
    },
  },
];
