"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  House,
  ShoppingBag,
  Package,
  Users,
  MessageSquareText,
  Megaphone,
  BarChart3,
  Settings,
} from "lucide-react";
import { useSetupGuide } from "@/components/onboarding/useSetupGuide";
import { SETUP_GUIDE_HREF } from "@/components/onboarding/LaunchChecklist";
import { Dock, type DockItem } from "./Dock";
import { DockAccount } from "./DockAccount";
import { canAccessPath } from "./module-access";

type HubPage = Pick<DockItem, "label" | "href" | "badge" | "match" | "alsoActiveOn">;
interface Hub {
  label: string;
  icon: React.ReactNode;
  pages: HubPage[];
}

const page = (label: string, href: string): HubPage => ({ label, href, match: href === "/" ? "exact" : "prefix" });

/**
 * Seven hubs instead of one icon per page: related pages share a hub, and hovering a hub lists them. Every page that
 * had its own dock icon is still one click away (hub → flyout) and keeps its URL.
 */
const HUBS: Hub[] = [
  { label: "Home", icon: <House size={20} strokeWidth={2} />, pages: [page("Overview", "/")] },
  { label: "Inbox", icon: <MessageSquareText size={20} strokeWidth={2} />, pages: [page("Conversations", "/conversations")] },
  {
    label: "Orders",
    icon: <ShoppingBag size={20} strokeWidth={2} />,
    pages: [page("Orders", "/orders"), page("Shipments", "/shipments"), page("Payments", "/payments")],
  },
  {
    label: "Catalog",
    icon: <Package size={20} strokeWidth={2} />,
    pages: [page("Products", "/products"), page("Inventory", "/inventory")],
  },
  {
    label: "Customers",
    icon: <Users size={20} strokeWidth={2} />,
    pages: [page("Customers", "/customers"), page("Engagement", "/engagement")],
  },
  {
    label: "Growth",
    icon: <Megaphone size={20} strokeWidth={2} />,
    pages: [page("Growth", "/growth"), page("Marketing", "/marketing"), page("Ad Manager", "/ads")],
  },
  {
    label: "Insights",
    icon: <BarChart3 size={20} strokeWidth={2} />,
    // The Intelligence pages (recommendations, insights, forecasts, ...) open from Analytics' Recommendations tab
    pages: [{ ...page("Analytics", "/analytics"), alsoActiveOn: ["/intelligence"] }, page("Ask your shop", "/assistant")],
  },
];

const SETTINGS_HUB: Hub = {
  label: "Settings",
  icon: <Settings size={20} strokeWidth={2} />,
  pages: [page("Settings", "/settings"), page("Connectors", "/connector"), page("Knowledge", "/knowledge")],
};

/** Keeps the pages this role can open; a hub with none is hidden, otherwise it links to its first open page. */
function toDockItem(hub: Hub, permissions: string[] | undefined): DockItem | null {
  const pages = hub.pages.filter((p) => canAccessPath(p.href, permissions));
  if (pages.length === 0) return null;
  const children: DockItem[] = pages.map((p) => ({ ...p, icon: null }));
  return { label: hub.label, href: pages[0].href, icon: hub.icon, match: pages[0].match, children };
}

export interface FloatingNavProps {
  tenantName?: string;
  userName?: string;
  userEmail?: string;
  userRole?: string;
  /** Tenant permissions of the signed-in user (from /api/v1/auth/session). */
  permissions?: string[];
  onOpenCommandPalette?: () => void;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({
  tenantName,
  userName,
  userEmail,
  userRole,
  permissions,
  onOpenCommandPalette,
}) => {
  const router = useRouter();
  // The setup guide stays reachable here until every required item is done, even after "Hide" on the dashboard
  const { status: guide } = useSetupGuide();

  // Show only the modules this role can use (FX-10); the API enforces the same permissions.
  const hubs = HUBS.map((hub) => {
    if (hub.label !== "Home" || !guide?.show_checklist) return hub;
    const progress = `${guide.required_done}/${guide.required_total}`;
    return { ...hub, pages: [...hub.pages, { label: "Setup guide", href: SETUP_GUIDE_HREF, badge: progress }] };
  });
  const items = hubs.map((hub) => toDockItem(hub, permissions)).filter((item): item is DockItem => item !== null);
  // The Home hub carries the setup guide's dot while the guide is unfinished
  const withGuideDot = items.map((item) =>
    item.label === "Home" && guide?.show_checklist ? { ...item, badge: `${guide.required_done}/${guide.required_total}` } : item,
  );
  const settings = toDockItem(SETTINGS_HUB, permissions);

  const handleLogout = async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      // Ignore
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <Dock
      items={withGuideDot}
      onSearch={onOpenCommandPalette}
      trailingItems={settings ? [settings] : []}
      onLogout={handleLogout}
      footer={
        userName ? (
          <DockAccount
            userName={userName}
            userEmail={userEmail}
            userRole={userRole}
            tenantName={tenantName}
            permissions={permissions}
            onLogout={handleLogout}
          />
        ) : undefined
      }
    />
  );
};
