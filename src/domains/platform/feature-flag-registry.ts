/**
 * Feature flags the code actually evaluates (super-admin console plan §F). A flag with any other key changes
 * nothing, so it can't be created or edited from the console. Pure data: safe to import from client components.
 *
 * `whenAbsent` is what the code does when no flag record exists: isFeatureEnabled treats a missing flag as ON;
 * the customer agent's strictFlag treats it as OFF.
 */
export interface KnownFlag {
  key: string;
  label: string;
  readBy: string;
  whenAbsent: "ON" | "OFF";
}

export const KNOWN_FLAGS: readonly KnownFlag[] = [
  {
    key: "autonomous",
    label: "Autonomous operations module",
    readBy: "src/lib/api-response.ts (/api/v1/autonomous/*), workflow worker, AI tool registry",
    whenAbsent: "ON",
  },
  {
    key: "enterprise",
    label: "Enterprise module",
    readBy: "src/lib/api-response.ts (/api/v1/enterprise/*), AI tool registry",
    whenAbsent: "ON",
  },
  {
    key: "real_messaging",
    label: "Real outbound messaging",
    readBy: "src/domains/social/outbound/outbound-message.service.ts",
    whenAbsent: "ON",
  },
  {
    key: "customer_agent_autonomous",
    label: "Customer agent: autonomous replies",
    readBy: "src/domains/ai/customer-agent/jobs.ts",
    whenAbsent: "OFF",
  },
  {
    key: "customer_agent_shadow",
    label: "Customer agent: shadow drafts",
    readBy: "src/domains/ai/customer-agent/jobs.ts",
    whenAbsent: "OFF",
  },
];

export function findKnownFlag(key: string): KnownFlag | undefined {
  return KNOWN_FLAGS.find((f) => f.key === key);
}
