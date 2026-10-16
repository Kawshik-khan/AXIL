"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Boxes,
  Truck,
  Users,
  MessageSquareText,
  Megaphone,
  BarChart3,
  Workflow,
  TrendingUp,
  Rocket,
  PlugZap,
  Heart,
  Target,
} from "lucide-react";
import { Dock, type DockItem } from "./Dock";
import { canAccessPath } from "./module-access";

const DOCK_ROUTES: DockItem[] = [
  { label: "Overview", href: "/", icon: <LayoutDashboard size={20} strokeWidth={2} /> },
  { label: "Orders", href: "/orders", icon: <ShoppingBag size={20} strokeWidth={2} /> },
  { label: "Products", href: "/products", icon: <Package size={20} strokeWidth={2} /> },
  { label: "Inventory", href: "/inventory", icon: <Boxes size={20} strokeWidth={2} /> },
  { label: "Shipments", href: "/shipments", icon: <Truck size={20} strokeWidth={2} /> },
  { label: "Customers", href: "/customers", icon: <Users size={20} strokeWidth={2} /> },
  { label: "Conversations", href: "/conversations", icon: <MessageSquareText size={20} strokeWidth={2} />, badge: "Omni" },
  { label: "Growth", href: "/growth", icon: <Rocket size={20} strokeWidth={2} /> },
  { label: "Marketing", href: "/marketing", icon: <Megaphone size={20} strokeWidth={2} /> },
  { label: "Engagement", href: "/engagement", icon: <Heart size={20} strokeWidth={2} /> },
  { label: "Ad Manager", href: "/ads", icon: <Target size={20} strokeWidth={2} /> },
  { label: "Analytics", href: "/analytics", icon: <BarChart3 size={20} strokeWidth={2} /> },
  { label: "Intelligence", href: "/intelligence", icon: <TrendingUp size={20} strokeWidth={2} />, badge: "AI" },
  { label: "Automations", href: "/automations", icon: <Workflow size={20} strokeWidth={2} /> },
  { label: "Connectors", href: "/connector", icon: <PlugZap size={20} strokeWidth={2} />, badge: "Hub" },
];

export interface FloatingNavProps {
  tenantName?: string;
  userName?: string;
  userRole?: string;
  /** Tenant permissions of the signed-in user (from /api/v1/auth/session). */
  permissions?: string[];
  onOpenCommandPalette?: () => void;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({ permissions, onOpenCommandPalette }) => {
  const router = useRouter();

  // Show only the modules this role can use (FX-10); the API enforces the same permissions.
  const filteredRoutes = DOCK_ROUTES.filter((route) => canAccessPath(route.href, permissions));

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
    <Dock items={filteredRoutes} onSearch={onOpenCommandPalette} settingsHref="/settings" onLogout={handleLogout} />
  );
};
