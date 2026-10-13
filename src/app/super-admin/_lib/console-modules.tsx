import React from "react";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  BrainCircuit,
  Workflow,
  Siren,
  ShieldCheck,
  ScrollText,
  TrendingUp,
} from "lucide-react";
import type { DockItem } from "@/components/navigation/Dock";
import { CONSOLE_ROOT, canAccessPlatformPath } from "./platform-module-access";

export interface ConsoleModule extends DockItem {
  description: string;
}

/** The console modules, in dock order (plan §3.2). Access is decided by platform-module-access.ts. */
export const CONSOLE_MODULES: ConsoleModule[] = [
  {
    label: "Control Tower",
    href: CONSOLE_ROOT,
    icon: <LayoutDashboard size={20} strokeWidth={2} />,
    description: "Platform state, KPIs and what needs attention",
  },
  {
    label: "Tenants",
    href: `${CONSOLE_ROOT}/tenants`,
    icon: <Building2 size={20} strokeWidth={2} />,
    match: "prefix",
    description: "Workspaces, lifecycle, usage and support",
  },
  {
    label: "Plans & Billing",
    href: `${CONSOLE_ROOT}/billing`,
    icon: <CreditCard size={20} strokeWidth={2} />,
    match: "prefix",
    description: "Plans, entitlements, add-ons and subscriptions",
  },
  {
    label: "AI Governance",
    href: `${CONSOLE_ROOT}/ai`,
    icon: <BrainCircuit size={20} strokeWidth={2} />,
    match: "prefix",
    badge: "AI",
    description: "Agent health, budgets, HITL queue and traces",
  },
  {
    label: "Automations",
    href: `${CONSOLE_ROOT}/automations`,
    icon: <Workflow size={20} strokeWidth={2} />,
    match: "prefix",
    description: "n8n, workflows, dead letters and provider rails",
  },
  {
    label: "Safety & Releases",
    href: `${CONSOLE_ROOT}/safety`,
    icon: <Siren size={20} strokeWidth={2} />,
    match: "prefix",
    description: "Kill switches, feature flags, incidents, maintenance",
  },
  {
    label: "Security",
    href: `${CONSOLE_ROOT}/security`,
    icon: <ShieldCheck size={20} strokeWidth={2} />,
    match: "prefix",
    description: "Operators, approvals, support sessions, compliance",
  },
  {
    label: "Audit",
    href: `${CONSOLE_ROOT}/audit`,
    icon: <ScrollText size={20} strokeWidth={2} />,
    match: "prefix",
    description: "Every privileged action, searchable and exportable",
  },
  {
    label: "Insights",
    href: `${CONSOLE_ROOT}/insights`,
    icon: <TrendingUp size={20} strokeWidth={2} />,
    match: "prefix",
    description: "Commerce velocity, RTO network, activation funnel",
  },
];

export const SETTINGS_PATH = `${CONSOLE_ROOT}/settings`;

export function visibleModules(permissions: readonly string[]): ConsoleModule[] {
  return CONSOLE_MODULES.filter((m) => canAccessPlatformPath(m.href, permissions));
}
