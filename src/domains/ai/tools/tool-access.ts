/**
 * Which tools a language model may call (FX-67, FX-68, FX-69; audit F01, F03, F06).
 *
 * The registry executes a tool only when it is on the calling agent's list, and never one of the tools below, whatever
 * an agent's list says or a model returns. Staff do these things through their own screens and routes, which call the
 * domain services directly and carry their own permission and approval checks.
 */

/** Tools that move money, change prices, send to customers in bulk, buy stock or switch safety controls. */
export const LLM_FORBIDDEN_TOOLS: ReadonlySet<string> = new Set([
  "verify_payment_transaction",
  "execute_price_change",
  "send_campaign",
  "schedule_campaign",
  "trigger_kill_switch",
  "create_purchase_order",
  "approve_autonomous_decision",
  "pause_domain_autonomy",
  "consolidate_procurement_demand",
  "execute_autonomous_cycle",
  "switch_courier",
]);

/** The inbox copilot ("Suggest") only reads: a suggestion never creates an order, a lead or a handoff. */
export const COPILOT_READ_ONLY_TOOLS: readonly string[] = [
  "search_products",
  "get_product",
  "check_inventory",
  "calculate_checkout",
  "search_knowledge",
  "get_order",
  "get_order_status",
  "get_shipment_status",
  "get_payment_status",
  "get_shipping_estimate",
];

/** The tools a model may be offered and call: the agent's own list, minus every forbidden tool. */
export function llmCallableTools(agentTools: readonly string[]): string[] {
  return agentTools.filter((name) => !LLM_FORBIDDEN_TOOLS.has(name));
}
