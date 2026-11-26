import type { AttentionItem } from "@/domains/platform/services/platform-attention.service";
import { CONSOLE_ROOT } from "./platform-module-access";

/** Pure helpers for the console sidebar: how many attention items point at each module and tab. */

export interface NavCount {
  count: number;
  /** At least one of the items is CRITICAL or HIGH. */
  urgent: boolean;
}

const pathOf = (href: string) => href.split(/[?#]/)[0];
const tabOf = (href: string) => new URLSearchParams(href.split("?")[1]?.split("#")[0] ?? "").get("tab");
const weight = (item: AttentionItem) => item.count ?? 1;
const isUrgent = (item: AttentionItem) => item.severity === "CRITICAL" || item.severity === "HIGH";

function total(items: readonly AttentionItem[]): NavCount | null {
  if (items.length === 0) return null;
  return { count: items.reduce((n, i) => n + weight(i), 0), urgent: items.some(isUrgent) };
}

/** Items whose link opens this module (the Control Tower is the root, so it matches only its own path). */
function inModule(items: readonly AttentionItem[], href: string): AttentionItem[] {
  return items.filter((i) => {
    const path = pathOf(i.href);
    return href === CONSOLE_ROOT ? path === CONSOLE_ROOT : path === href || path.startsWith(`${href}/`);
  });
}

/**
 * The count shown beside a module: every item for the Control Tower (it lists them all), otherwise the items whose
 * link opens that module. null when nothing points there, so no badge is drawn.
 */
export function moduleCount(items: readonly AttentionItem[], href: string): NavCount | null {
  return href === CONSOLE_ROOT ? { count: items.length, urgent: items.some(isUrgent) } : total(inModule(items, href));
}

export function tabCount(items: readonly AttentionItem[], href: string, tabId: string): NavCount | null {
  return total(inModule(items, href).filter((i) => tabOf(i.href) === tabId));
}

/** How many approval requests and late handovers are waiting, from the items that carry those counts. */
export function waitingWork(items: readonly AttentionItem[]): { approvals: number; handovers: number } {
  const sum = (category: AttentionItem["category"]) => items.filter((i) => i.category === category).reduce((n, i) => n + weight(i), 0);
  return { approvals: sum("APPROVAL"), handovers: sum("HITL") };
}

/** True when a link with `?tab=` matches the page in view. */
export function isTabActive(pathname: string, tab: string | null, href: string, tabId: string, firstTabId: string): boolean {
  return pathname === href && (tab === tabId || (!tab && tabId === firstTabId));
}
