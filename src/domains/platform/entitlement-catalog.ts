/**
 * Entitlement catalog (super-admin console plan C1). Declares every plan limit or feature the platform knows about
 * and the code that enforces it. Only entries with `enforcedBy` can be put on a plan, an override or an add-on:
 * a limit nobody checks would be a control that changes nothing. Pure data: safe to import from client components.
 *
 * Adding a new enforced limit = write its counter and its gate, then set `enforcedBy` here.
 */

export type EntitlementKind =
  /** A cap on things that exist now (users, products, channels); counted live. */
  | "COUNT_LIMIT"
  /** A cap on use within a calendar month (AI runs); counted from usage records. */
  | "PERIOD_QUOTA"
  /** On/off access to a capability. */
  | "FEATURE";

export interface EntitlementSpec {
  id: string;
  label: string;
  description: string;
  kind: EntitlementKind;
  unit?: string;
  min?: number;
  max?: number;
  /** Whether "unlimited" (no cap) may be chosen. */
  allowUnlimited: boolean;
  /** The code that enforces it; null = not enforced yet, so it can't be set. */
  enforcedBy: string | null;
  /** Whether an add-on may raise it. */
  addonEligible: boolean;
}

export const ENTITLEMENT_CATALOG: readonly EntitlementSpec[] = [
  {
    id: "max_users",
    label: "Staff users",
    description: "Active members plus pending invitations in the workspace.",
    kind: "COUNT_LIMIT",
    unit: "users",
    min: 1,
    max: 100_000,
    allowUnlimited: true,
    enforcedBy: "src/lib/safety-gate.ts assertWithinLimit (invitations)",
    addonEligible: true,
  },
  {
    id: "max_products",
    label: "Catalog products",
    description: "Products in the catalog, including bulk imports.",
    kind: "COUNT_LIMIT",
    unit: "products",
    min: 0,
    max: 10_000_000,
    allowUnlimited: true,
    enforcedBy: "src/lib/safety-gate.ts assertWithinLimit (product create, bulk import)",
    addonEligible: true,
  },
  {
    id: "max_channels",
    label: "Connected channels",
    description: "Facebook, Instagram, WhatsApp and other connected sales channels.",
    kind: "COUNT_LIMIT",
    unit: "channels",
    min: 0,
    max: 1_000,
    allowUnlimited: true,
    enforcedBy: "src/lib/safety-gate.ts assertWithinLimit (channel connect)",
    addonEligible: true,
  },
  {
    id: "ai_monthly_runs",
    label: "AI agent runs per month",
    description: "Agent runs in the current calendar month.",
    kind: "PERIOD_QUOTA",
    unit: "runs / month",
    min: 0,
    max: 100_000_000,
    allowUnlimited: true,
    enforcedBy: "src/domains/ai/agents/base-agent.ts and runtime/agent-runtime.ts (PlatformEntitlementService.can)",
    addonEligible: true,
  },
  // Declared but not enforced yet: listed in the console as "Not enforced yet" and refused on plans.
  {
    id: "max_orders_per_month",
    label: "Orders per month",
    description: "No gate counts orders against a plan yet.",
    kind: "PERIOD_QUOTA",
    unit: "orders / month",
    allowUnlimited: true,
    enforcedBy: null,
    addonEligible: false,
  },
  {
    id: "max_automations",
    label: "Active automations",
    description: "No gate counts active automations yet.",
    kind: "COUNT_LIMIT",
    unit: "automations",
    allowUnlimited: true,
    enforcedBy: null,
    addonEligible: false,
  },
  {
    id: "max_n8n_executions",
    label: "n8n executions per month",
    description: "No gate counts n8n executions yet.",
    kind: "PERIOD_QUOTA",
    unit: "executions / month",
    allowUnlimited: true,
    enforcedBy: null,
    addonEligible: false,
  },
  {
    id: "max_storage_gb",
    label: "Storage",
    description: "No gate measures storage yet.",
    kind: "COUNT_LIMIT",
    unit: "GB",
    allowUnlimited: true,
    enforcedBy: null,
    addonEligible: false,
  },
  {
    id: "automation.n8n",
    label: "n8n workflow engine",
    description: "No route checks this feature yet.",
    kind: "FEATURE",
    allowUnlimited: false,
    enforcedBy: null,
    addonEligible: false,
  },
  {
    id: "ai.agentic_workflows",
    label: "Autonomous AI agents",
    description: "No route checks this feature yet; the platform `autonomous` flag gates it today.",
    kind: "FEATURE",
    allowUnlimited: false,
    enforcedBy: null,
    addonEligible: false,
  },
  {
    id: "support.priority",
    label: "Priority support",
    description: "A service commitment, not a software gate; not settable until support tooling reads it.",
    kind: "FEATURE",
    allowUnlimited: false,
    enforcedBy: null,
    addonEligible: false,
  },
];

export function findEntitlementSpec(id: string): EntitlementSpec | undefined {
  return ENTITLEMENT_CATALOG.find((e) => e.id === id);
}

/** A plan/override value: a number (cap), true/false (feature), or null (unlimited / not gated). */
export type EntitlementValue = number | boolean | null;

/**
 * Checks one plan/override value against the catalog. Returns an error message, or null when the value is valid.
 * Unknown and not-enforced ids are refused (plan decision D8).
 */
export function entitlementValueError(id: string, value: unknown): string | null {
  const spec = findEntitlementSpec(id);
  if (!spec) return `"${id}" is not in the entitlement catalog.`;
  if (!spec.enforcedBy) return `"${spec.label}" is not enforced yet, so it can't be set.`;
  if (value === null) return spec.allowUnlimited ? null : `"${spec.label}" can't be unlimited.`;
  if (spec.kind === "FEATURE") return typeof value === "boolean" ? null : `"${spec.label}" must be on or off.`;
  if (typeof value !== "number" || !Number.isInteger(value)) return `"${spec.label}" must be a whole number.`;
  if (spec.min !== undefined && value < spec.min) return `"${spec.label}" must be at least ${spec.min}.`;
  if (spec.max !== undefined && value > spec.max) return `"${spec.label}" must be at most ${spec.max}.`;
  return null;
}

/** Validates a whole plan `features` map; returns every problem found. */
export function featureMapErrors(features: Record<string, unknown>): string[] {
  return Object.entries(features)
    .map(([id, value]) => entitlementValueError(id, value))
    .filter((e): e is string => e !== null);
}
