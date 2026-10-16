/**
 * Privileged platform actions (super-admin console plan §5.2, rules/privileged-actions.md §3.1). One declaration per
 * action: risk tier, permission, and the safeguards the server enforces (step-up, reason, ticket, two-person
 * approval, typed confirmation). The console reads the same declarations to decide which steps to ask for — it
 * never decides whether an action is allowed. Pure data: safe to import from client components.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ApprovalPolicy =
  | "never"
  | "always"
  /** rules/privileged-actions.md §1: HIGH actions on tenants active for more than 30 days. */
  | "if_tenant_older_than_30d"
  /** Plan migrations above the `plans.migration_approval_threshold` setting. */
  | "if_count_above_threshold";

export interface PrivilegedActionSpec {
  key: string;
  label: string;
  risk: RiskLevel;
  permission: string;
  stepUp: boolean;
  approval: ApprovalPolicy;
  /** Minimum reason length; 0 = no reason asked (LOW). */
  reasonMin: number;
  ticketRequired: boolean;
  /** CRITICAL: the exact phrase the operator must type, built from the target. */
  confirmPhrase?: (target: { slug?: string; id: string }) => string;
  /** A reversible action's undo, as another action key. */
  inverse?: string;
  /** The documented recovery path (rules/privileged-actions.md §3.5). */
  rollback: string;
}

const REASON = 10;

export const PRIVILEGED_ACTIONS: readonly PrivilegedActionSpec[] = [
  // Tenants
  { key: "tenant.create", label: "Provision tenant", risk: "MEDIUM", permission: "tenant.create", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Archive the tenant." },
  { key: "tenant.suspend", label: "Suspend tenant", risk: "HIGH", permission: "tenant.suspend", stepUp: true, approval: "if_tenant_older_than_30d", reasonMin: REASON, ticketRequired: true, rollback: "Reactivate the tenant." },
  { key: "tenant.activate", label: "Reactivate tenant", risk: "MEDIUM", permission: "tenant.activate", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Suspend the tenant again." },
  { key: "tenant.archive", label: "Archive tenant", risk: "HIGH", permission: "tenant.archive", stepUp: true, approval: "if_tenant_older_than_30d", reasonMin: REASON, ticketRequired: true, rollback: "No unarchive action exists yet; the workspace data is kept." },
  {
    key: "tenant.purge",
    label: "Purge tenant data",
    risk: "CRITICAL",
    permission: "tenant.delete",
    stepUp: true,
    approval: "always",
    reasonMin: REASON,
    ticketRequired: true,
    confirmPhrase: (t) => `CONFIRM_PURGE_${(t.slug ?? t.id).toUpperCase()}`,
    rollback: "Restore from backup during the tombstone period; afterwards irreversible.",
  },
  // Subscriptions, plans, entitlements, add-ons
  { key: "subscription.change_plan", label: "Change plan", risk: "MEDIUM", permission: "subscription.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Change the plan back." },
  { key: "subscription.extend_trial", label: "Extend trial", risk: "MEDIUM", permission: "subscription.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Shorten the trial with another extension." },
  { key: "entitlement.override", label: "Override a limit", risk: "HIGH", permission: "entitlement.manage", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: true, inverse: "entitlement.clear_override", rollback: "Clear the override." },
  { key: "entitlement.clear_override", label: "Remove a limit override", risk: "MEDIUM", permission: "entitlement.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Set the override again." },
  { key: "entitlement.default_update", label: "Change a global default limit", risk: "HIGH", permission: "entitlement.manage", stepUp: true, approval: "always", reasonMin: REASON, ticketRequired: true, rollback: "Set the previous default." },
  { key: "addon.create", label: "Create add-on", risk: "MEDIUM", permission: "plan.create", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Retire the add-on." },
  { key: "addon.retire", label: "Retire add-on", risk: "MEDIUM", permission: "plan.update", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Create it again." },
  { key: "addon.grant", label: "Grant add-on", risk: "MEDIUM", permission: "entitlement.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, inverse: "addon.revoke", rollback: "Revoke the add-on." },
  { key: "addon.revoke", label: "Revoke add-on", risk: "MEDIUM", permission: "entitlement.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Grant it again." },
  { key: "plan.create", label: "Create plan", risk: "MEDIUM", permission: "plan.create", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Deactivate the plan." },
  { key: "plan.update", label: "Edit plan details", risk: "MEDIUM", permission: "plan.update", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Edit the details back." },
  { key: "plan.version_draft", label: "Save plan draft", risk: "LOW", permission: "plan.update", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Delete or edit the draft." },
  { key: "plan.version_publish", label: "Publish plan version", risk: "MEDIUM", permission: "plan.update", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Retire the version; existing subscribers are unaffected." },
  { key: "plan.version_retire", label: "Retire plan version", risk: "MEDIUM", permission: "plan.update", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Publish a new version with the same terms." },
  { key: "plan.migrate", label: "Move tenants to another plan version", risk: "HIGH", permission: "subscription.manage", stepUp: true, approval: "if_count_above_threshold", reasonMin: REASON, ticketRequired: true, rollback: "Migrate the same tenants back." },
  // Safety
  { key: "kill_switch.activate", label: "Activate kill switch", risk: "HIGH", permission: "security.manage", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: true, rollback: "Deactivate the switch." },
  {
    key: "kill_switch.activate_global",
    label: "Activate GLOBAL kill switch",
    risk: "CRITICAL",
    permission: "security.manage",
    stepUp: true,
    approval: "always",
    reasonMin: REASON,
    ticketRequired: true,
    confirmPhrase: () => "CONFIRM KILL SWITCH",
    rollback: "Deactivate the GLOBAL switch (also two-person).",
  },
  { key: "kill_switch.deactivate", label: "Deactivate kill switch", risk: "HIGH", permission: "security.manage", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: true, rollback: "Activate it again." },
  { key: "kill_switch.deactivate_global", label: "Deactivate GLOBAL kill switch", risk: "CRITICAL", permission: "security.manage", stepUp: true, approval: "always", reasonMin: REASON, ticketRequired: true, rollback: "Activate it again." },
  { key: "feature_flag.save", label: "Change feature flag", risk: "MEDIUM", permission: "feature_flag.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Save the previous flag settings." },
  { key: "incident.declare", label: "Declare incident", risk: "MEDIUM", permission: "platform.manage", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Resolve the incident." },
  { key: "incident.update", label: "Update incident", risk: "MEDIUM", permission: "platform.manage", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Update the status again." },
  { key: "maintenance.schedule", label: "Schedule maintenance", risk: "MEDIUM", permission: "maintenance.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Cancel the window." },
  { key: "maintenance.cancel", label: "Cancel maintenance window", risk: "MEDIUM", permission: "maintenance.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Schedule it again." },
  { key: "announcement.save", label: "Save announcement draft", risk: "LOW", permission: "announcement.create", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Edit or leave the draft unpublished." },
  { key: "announcement.publish", label: "Publish announcement", risk: "MEDIUM", permission: "announcement.publish", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Unpublish the announcement." },
  // Security & support
  { key: "support.impersonate", label: "Start support session", risk: "HIGH", permission: "support.impersonate", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: true, rollback: "End the session." },
  { key: "tenant.purge_cancel", label: "Cancel scheduled purge", risk: "HIGH", permission: "tenant.delete", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: true, rollback: "Schedule the purge again." },
  { key: "support.revoke", label: "End support session", risk: "LOW", permission: "support.impersonate", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Start a new session." },
  { key: "operator.assign_role", label: "Change operator role", risk: "CRITICAL", permission: "security.manage", stepUp: true, approval: "always", reasonMin: REASON, ticketRequired: true, rollback: "Assign the previous role." },
  { key: "approval.decide", label: "Approve or reject a request", risk: "HIGH", permission: "approval.decide", stepUp: true, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "A rejected request can be requested again; an approved one can be cancelled before it runs." },
  { key: "platform_config.update_governed", label: "Change an approval or billing policy setting", risk: "CRITICAL", permission: "platform_config.manage", stepUp: true, approval: "always", reasonMin: REASON, ticketRequired: true, rollback: "Restore the previous version (also two-person)." },
  { key: "ai.hitl.takeover", label: "Take over a customer conversation", risk: "MEDIUM", permission: "ai.hitl.manage", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Resolve and resume the AI." },
  { key: "platform_config.update", label: "Change platform setting", risk: "HIGH", permission: "platform_config.manage", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Restore the previous version." },
  { key: "compliance.export", label: "Export tenant data (customer PII)", risk: "HIGH", permission: "tenant.read", stepUp: true, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Exports can't be recalled; each one is audited with its checksum." },
  { key: "audit.export", label: "Export audit ledger", risk: "MEDIUM", permission: "audit.export", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Exports can't be recalled; they are themselves audited." },
  // AI & automations
  { key: "ai.budget.update", label: "Change AI budget", risk: "HIGH", permission: "platform.manage", stepUp: true, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "Set the previous budget." },
  { key: "dlq.retry", label: "Retry dead letter", risk: "MEDIUM", permission: "dlq.retry", stepUp: false, approval: "never", reasonMin: 0, ticketRequired: false, rollback: "Resolve the item if the retry fails again." },
  { key: "dlq.resolve", label: "Resolve dead letter", risk: "MEDIUM", permission: "dlq.resolve", stepUp: false, approval: "never", reasonMin: REASON, ticketRequired: false, rollback: "None needed; the event stays in the audit." },
];

export function findPrivilegedAction(key: string): PrivilegedActionSpec | undefined {
  return PRIVILEGED_ACTIONS.find((a) => a.key === key);
}

/** The approval policy in force for one execution (the "if_*" policies resolved against the target). */
export function approvalRequired(
  spec: PrivilegedActionSpec,
  facts: { tenantCreatedAt?: string; affectedCount?: number; countThreshold?: number; now?: number } = {}
): boolean {
  switch (spec.approval) {
    case "never":
      return false;
    case "always":
      return true;
    case "if_tenant_older_than_30d": {
      if (!facts.tenantCreatedAt) return true; // unknown age: fail closed
      const age = (facts.now ?? Date.now()) - Date.parse(facts.tenantCreatedAt);
      return Number.isNaN(age) || age > 30 * 24 * 60 * 60 * 1000;
    }
    case "if_count_above_threshold":
      return facts.affectedCount === undefined || facts.countThreshold === undefined || facts.affectedCount > facts.countThreshold;
  }
}
