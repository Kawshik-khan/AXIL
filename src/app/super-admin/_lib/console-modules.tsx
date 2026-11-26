import React from "react";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  BrainCircuit,
  Siren,
  ShieldCheck,
  ScrollText,
  TrendingUp,
  Settings,
} from "lucide-react";
import type { DockItem } from "@/components/navigation/Dock";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { CONSOLE_ROOT, canAccessPlatformPath } from "./platform-module-access";

export type ConsoleSection = "Operate" | "Govern" | "Analyse";

/** A tab inside a module page (its `?tab=` id), shown under the module in the sidebar. */
export interface ConsoleModuleTab {
  id: string;
  label: string;
  /** Hidden without it; the same check the page applies to the tab. */
  permission?: string;
}

export interface ConsoleModule extends DockItem {
  description: string;
  section: ConsoleSection;
  tabs?: readonly ConsoleModuleTab[];
}

/** The console modules, in sidebar order (plan §3.2). Access is decided by platform-module-access.ts. */
export const CONSOLE_MODULES: ConsoleModule[] = [
  {
    label: "Control Tower",
    href: CONSOLE_ROOT,
    icon: <LayoutDashboard size={20} strokeWidth={2} />,
    section: "Operate",
    description: "Platform state, KPIs and what needs attention",
  },
  {
    label: "Tenants",
    href: `${CONSOLE_ROOT}/tenants`,
    icon: <Building2 size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Operate",
    description: "Workspaces, lifecycle, usage and support",
  },
  {
    label: "Plans & Billing",
    href: `${CONSOLE_ROOT}/billing`,
    icon: <CreditCard size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Operate",
    description: "Plans, entitlements, add-ons and subscriptions",
    tabs: [
      { id: "plans", label: "Plans" },
      { id: "catalog", label: "Entitlement catalog", permission: PLATFORM_PERMISSIONS.ENTITLEMENT_READ },
      { id: "addons", label: "Add-ons" },
      { id: "subscriptions", label: "Subscriptions", permission: PLATFORM_PERMISSIONS.SUBSCRIPTION_READ },
      { id: "invoices", label: "Invoices", permission: PLATFORM_PERMISSIONS.BILLING_READ },
      { id: "payments", label: "Payment methods", permission: PLATFORM_PERMISSIONS.BILLING_READ },
      { id: "migrate", label: "Move tenants", permission: PLATFORM_PERMISSIONS.SUBSCRIPTION_READ },
    ],
  },
  {
    label: "AI Governance",
    href: `${CONSOLE_ROOT}/ai`,
    icon: <BrainCircuit size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Govern",
    description: "Agent health, budgets, HITL queue and traces",
    tabs: [
      { id: "health", label: "Fleet health" },
      { id: "budgets", label: "Budgets" },
      { id: "hitl", label: "Human handover" },
      { id: "traces", label: "Traces" },
      { id: "rollout", label: "Rollout" },
      { id: "models", label: "Models", permission: PLATFORM_PERMISSIONS.ANALYTICS_PLATFORM_READ },
    ],
  },
  {
    label: "Safety & Releases",
    href: `${CONSOLE_ROOT}/safety`,
    icon: <Siren size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Govern",
    description: "Kill switches, feature flags, incidents, maintenance",
    tabs: [
      { id: "kill", label: "Kill switches", permission: PLATFORM_PERMISSIONS.SECURITY_READ },
      { id: "flags", label: "Feature flags", permission: PLATFORM_PERMISSIONS.FEATURE_FLAG_READ },
      { id: "incidents", label: "Incidents" },
      { id: "maintenance", label: "Maintenance", permission: PLATFORM_PERMISSIONS.MAINTENANCE_READ },
      { id: "announcements", label: "Announcements" },
    ],
  },
  {
    label: "Security",
    href: `${CONSOLE_ROOT}/security`,
    icon: <ShieldCheck size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Govern",
    description: "Operators, approvals, support sessions, compliance",
    tabs: [
      { id: "approvals", label: "Approvals" },
      { id: "operators", label: "Operators" },
      { id: "support", label: "Support sessions", permission: PLATFORM_PERMISSIONS.SUPPORT_READ },
      { id: "compliance", label: "Compliance export", permission: PLATFORM_PERMISSIONS.TENANT_READ },
    ],
  },
  {
    label: "Audit",
    href: `${CONSOLE_ROOT}/audit`,
    icon: <ScrollText size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Govern",
    description: "Every privileged action, searchable and exportable",
  },
  {
    label: "Insights",
    href: `${CONSOLE_ROOT}/insights`,
    icon: <TrendingUp size={20} strokeWidth={2} />,
    match: "prefix",
    section: "Analyse",
    description: "Commerce velocity, RTO network, activation funnel",
  },
];

export const SETTINGS_PATH = `${CONSOLE_ROOT}/settings`;

export const SETTINGS_MODULE: ConsoleModule = {
  label: "Settings",
  href: SETTINGS_PATH,
  icon: <Settings size={20} strokeWidth={2} />,
  match: "prefix",
  section: "Analyse",
  description: "Platform settings, their history and approvals",
};

export function visibleModules(permissions: readonly string[]): ConsoleModule[] {
  return CONSOLE_MODULES.filter((m) => canAccessPlatformPath(m.href, permissions));
}

/** Every sidebar entry the role can open, Settings included, with only the tabs the role can see. */
export function sidebarModules(permissions: readonly string[]): ConsoleModule[] {
  return [...CONSOLE_MODULES, SETTINGS_MODULE]
    .filter((m) => canAccessPlatformPath(m.href, permissions))
    .map((m) => (m.tabs ? { ...m, tabs: m.tabs.filter((t) => !t.permission || permissions.includes(t.permission)) } : m));
}
