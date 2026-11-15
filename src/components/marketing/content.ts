/**
 * Copy for the landing page's interactive parts. Every status here is checked against .agent/STATUS.md:
 * agents read and draft (AI workflows: PARTIAL, read-only), the inbox is Telegram in beta, online payments are being
 * proven, Meta channels and courier booking are planned. tests/landing-routing-tests.ts holds the connector statuses
 * to that. The order numbers and amounts in the scenarios are example data for the demo, never metrics.
 */

export type AgentId =
  | "order"
  | "support"
  | "sales"
  | "social"
  | "inventory"
  | "delivery"
  | "payment"
  | "marketing"
  | "analytics"
  | "product"
  | "finance"
  | "seo";

/** The twelve agents in the hub, with where each node sits on the 740 × 600 fan (centre of its icon). */
export const AGENTS: readonly { id: AgentId; name: string; x: number; y: number }[] = [
  { id: "order", name: "Order", x: 380, y: 150 },
  { id: "support", name: "Customer support", x: 380, y: 300 },
  { id: "sales", name: "Sales", x: 380, y: 450 },
  { id: "social", name: "Social commerce", x: 520, y: 75 },
  { id: "inventory", name: "Inventory", x: 520, y: 225 },
  { id: "delivery", name: "Delivery", x: 520, y: 375 },
  { id: "payment", name: "Payment", x: 520, y: 525 },
  { id: "marketing", name: "Marketing", x: 660, y: 60 },
  { id: "analytics", name: "Analytics", x: 660, y: 180 },
  { id: "product", name: "Product", x: 660, y: 300 },
  { id: "finance", name: "Finance", x: 660, y: 420 },
  { id: "seo", name: "SEO", x: 660, y: 540 },
];

export interface Scenario {
  id: string;
  /** Chip label above the chat. */
  label: string;
  customer: { name: string; initial: string };
  /** What the customer wrote (Banglish, as customers write). */
  message: string;
  /** The AI's draft, shown in shadow mode: it is not sent. */
  draft: string;
  /** Agents lit up in the hub. */
  agents: AgentId[];
  /** The merchant-side card under the hub. */
  card: { agent: string; title: string; body: string; items: string[]; cta: string };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "status",
    label: "Order status",
    customer: { name: "Rafi Ahmed", initial: "R" },
    message: "Amar order er progress ki?",
    draft: "Apnar order #CO-1042 CONFIRMED. Kal courier-e handover hobe, tracking link pathiye dibo. Payment cash on delivery.",
    agents: ["order", "payment"],
    card: {
      agent: "Order agent",
      title: "3 orders are waiting for you",
      body: "Three cash-on-delivery orders are above your approval limit.",
      items: ["#CO-1042 · ৳1,450 · Mirpur · low return risk", "#CO-1045 · ৳3,200 · Chattogram · medium risk", "#CO-1047 · ৳2,100 · Uttara · first-time buyer"],
      cta: "Approve 2 low-risk orders",
    },
  },
  {
    id: "stock",
    label: "Stock",
    customer: { name: "Nusrat Jahan", initial: "N" },
    message: "Eid er age L size panjabi pabo?",
    draft: "L size e ekhon 3 ta baki ache. Chaile ekhoni apnar jonno ekta order draft kore rakhi?",
    agents: ["inventory", "analytics"],
    card: {
      agent: "Inventory agent",
      title: "4 variants will sell out soon",
      body: "Based on the last 30 days of paid orders, these will run out in under a week.",
      items: ["Cotton panjabi · L · 3 left", "Silk saree · maroon · 5 left", "Kids kurta · 6Y · 2 left"],
      cta: "Draft a restock list",
    },
  },
  {
    id: "charge",
    label: "Delivery charge",
    customer: { name: "Tanha Islam", initial: "T" },
    message: "Dhanmondi te delivery charge koto?",
    draft: "Dhanmondi Inside Dhaka zone-e pore. Delivery charge apnar zone settings theke boshano hobe, 1-2 diner moddhe peye jaben.",
    agents: ["support", "social"],
    card: {
      agent: "Customer support agent",
      title: "7 replies drafted",
      body: "Drafted in shadow mode, using real stock and your delivery fees, for you to compare. Nothing is sent.",
      items: ["Rafi · price and size for the cotton panjabi", "Nusrat · delivery charge to Dhanmondi", "Tanha · blue dress restock date"],
      cta: "Review drafts",
    },
  },
  {
    id: "offer",
    label: "Offer",
    customer: { name: "Sabbir Hossain", initial: "S" },
    message: "Friday offer ta ki ekhono ache?",
    draft: "Ji, Friday offer ajke rat 12 ta porjonto ache. Kon product ta dekhte chan?",
    agents: ["marketing", "analytics", "sales"],
    card: {
      agent: "Marketing agent",
      title: "Friday campaign report",
      body: "Orders, revenue and returns from people who came through the campaign post.",
      items: ["Messages and orders it started", "Paid revenue after returns", "Best-selling product from the post"],
      cta: "Open the report",
    },
  },
  {
    id: "eta",
    label: "Delivery time",
    customer: { name: "Mim Akter", initial: "M" },
    message: "R koi din lagbe?",
    draft: "Apnar order READY_TO_SHIP. Kushtia-r jonno usually 2-4 working days lage. Courier-e handover hole tracking pathabo.",
    agents: ["delivery", "order"],
    card: {
      agent: "Delivery agent",
      title: "5 parcels ready to ship",
      body: "Grouped by zone with your delivery fees, ready to hand to your courier. In-app booking is planned.",
      items: ["3 parcels · inside Dhaka", "1 parcel · Dhaka suburbs", "1 parcel · outside Dhaka"],
      cta: "Copy parcel list",
    },
  },
];

export type ConnectorStatus = "live" | "beta" | "planned";

export interface Connector {
  id: string;
  name: string;
  kind: "Channel" | "Payment" | "Courier" | "AI model";
  status: ConnectorStatus;
  /** Brand icon under /public, or a short mark when the connector has no brand. */
  icon?: string;
  mark?: string;
}

/** Rows of the staggered tile grid. Statuses follow .agent/STATUS.md (Webhooks / Online payments / External integrations). */
export const CONNECTOR_ROWS: readonly Connector[][] = [
  [
    { id: "facebook", name: "Facebook", kind: "Channel", status: "planned", icon: "/images/icons/channels/facebook.svg" },
    { id: "instagram", name: "Instagram", kind: "Channel", status: "planned", icon: "/images/icons/channels/instagram.svg" },
    { id: "whatsapp", name: "WhatsApp", kind: "Channel", status: "planned", icon: "/images/icons/channels/whatsapp.svg" },
  ],
  [
    { id: "telegram", name: "Telegram", kind: "Channel", status: "beta", icon: "/images/icons/channels/telegram.svg" },
    { id: "bkash", name: "bKash", kind: "Payment", status: "beta", icon: "/images/icons/channels/bkash.svg" },
    { id: "sslcommerz", name: "SSLCommerz", kind: "Payment", status: "beta", icon: "/images/icons/channels/sslcommerz.svg" },
  ],
  [
    { id: "steadfast", name: "Steadfast", kind: "Courier", status: "planned", icon: "/images/icons/channels/steadfast.svg" },
    { id: "cod", name: "Cash on delivery", kind: "Payment", status: "live", mark: "৳" },
    { id: "ai", name: "Your AI model", kind: "AI model", status: "live", mark: "AI" },
  ],
];

export const STATUS_LABEL: Record<ConnectorStatus, string> = { live: "Live", beta: "Beta", planned: "Planned" };

export const ROADMAP = {
  live: [
    ["Orders", "with a single lifecycle and audit trail"],
    ["Products, variants and inventory", ""],
    ["Customers", "and a shared inbox"],
    ["Roles and permissions", "on every route"],
    ["Analytics", "that never invent numbers"],
    ["Platform controls", ": kill switches, plan limits, read-only support sessions"],
  ],
  proving: [
    ["Telegram inbox", ": built and tested, awaiting a live bot"],
    ["AI agents", "with approvals, read-only tasks so far"],
    ["Customer chat agent", ": shadow mode before any live use"],
    ["Knowledge answers", "with citations, still being measured"],
  ],
  planned: [
    ["Sending", "on WhatsApp, Messenger and Instagram"],
    ["Courier booking", "from inside the app"],
    ["bKash and Nagad", "payment verification"],
    ["Campaign sending", "with frequency caps"],
  ],
} as const;
