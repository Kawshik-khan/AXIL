"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Sparkles,
  Workflow,
  TrendingUp,
  Search,
  Settings,
  LogOut,
  Rocket,
  Cpu,
  Building2,
  PlugZap,
} from "lucide-react";
import styles from "./FloatingNav.module.css";

interface DockRoute {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
}

const DOCK_ROUTES: DockRoute[] = [
  { label: "Overview", href: "/", icon: <LayoutDashboard size={20} strokeWidth={2} /> },
  { label: "Orders", href: "/orders", icon: <ShoppingBag size={20} strokeWidth={2} /> },
  { label: "Products", href: "/products", icon: <Package size={20} strokeWidth={2} /> },
  { label: "Inventory", href: "/inventory", icon: <Boxes size={20} strokeWidth={2} /> },
  { label: "Shipments", href: "/shipments", icon: <Truck size={20} strokeWidth={2} /> },
  { label: "Customers", href: "/customers", icon: <Users size={20} strokeWidth={2} /> },
  { label: "Conversations", href: "/conversations", icon: <MessageSquareText size={20} strokeWidth={2} />, badge: "Omni" },
  { label: "Growth", href: "/growth", icon: <Rocket size={20} strokeWidth={2} />, badge: "P7" },
  { label: "Operations", href: "/operations", icon: <Cpu size={20} strokeWidth={2} />, badge: "P8" },
  { label: "Enterprise", href: "/enterprise", icon: <Building2 size={20} strokeWidth={2} />, badge: "P9" },
  { label: "Autonomous", href: "/autonomous", icon: <Sparkles size={20} strokeWidth={2} />, badge: "P10" },
  { label: "Marketing", href: "/marketing", icon: <Megaphone size={20} strokeWidth={2} /> },
  { label: "Analytics", href: "/analytics", icon: <BarChart3 size={20} strokeWidth={2} /> },
  { label: "Intelligence", href: "/intelligence", icon: <TrendingUp size={20} strokeWidth={2} />, badge: "AI" },
  { label: "AI Agents", href: "/agents", icon: <Sparkles size={20} strokeWidth={2} />, badge: "AI" },
  { label: "Automations", href: "/automations", icon: <Workflow size={20} strokeWidth={2} /> },
  { label: "Connectors", href: "/connector", icon: <PlugZap size={20} strokeWidth={2} />, badge: "Hub" },
];

export interface FloatingNavProps {
  tenantName?: string;
  userName?: string;
  userRole?: string;
  onOpenCommandPalette?: () => void;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({ userRole, onOpenCommandPalette }) => {
  const pathname = usePathname();
  const router = useRouter();

  const isPrivileged = userRole === "OWNER" || userRole === "ADMIN" || userRole === "DEV";

  // Filter routes based on role (Automations strictly restricted to Owner/Admin/Dev)
  const filteredRoutes = DOCK_ROUTES.filter((route) => {
    if (route.href === "/automations") {
      return isPrivileged;
    }
    return true;
  });

  // Strictly merchant dock routes
  const effectiveRoutes: DockRoute[] = filteredRoutes;

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
    <nav className={styles.dockWrapper} aria-label="Floating Dock Navigation">
      <div className={styles.dockPill}>
        {/* Navigation Circular Buttons */}
        {effectiveRoutes.map((route) => {
          const isActive = pathname === route.href;
          return (
            <Link
              key={route.href}
              href={route.href}
              className={`${styles.dockCircle} ${isActive ? styles.activeCircle : styles.inactiveCircle}`}
              aria-label={route.label}
              title={route.label}
            >
              <div className={styles.iconContainer}>{route.icon}</div>
              <span className={styles.dockTooltip}>{route.label}</span>
              {route.badge && !isActive && <span className={styles.circleDot} />}
            </Link>
          );
        })}

        <div className={styles.dockDivider} />

        {/* Search Circular Button (Triggers Cmd+K) */}
        {onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className={`${styles.dockCircle} ${styles.inactiveCircle}`}
            aria-label="Search (Cmd+K)"
            title="Search (Cmd+K)"
          >
            <div className={styles.iconContainer}>
              <Search size={19} strokeWidth={2} />
            </div>
            <span className={styles.dockTooltip}>Search (⌘K)</span>
          </button>
        )}

        {/* Settings Circular Button */}
        <Link
          href="/settings"
          className={`${styles.dockCircle} ${
            pathname === "/settings" ? styles.activeCircle : styles.inactiveCircle
          }`}
          aria-label="Settings"
          title="Settings"
        >
          <div className={styles.iconContainer}>
            <Settings size={20} strokeWidth={2} />
          </div>
          <span className={styles.dockTooltip}>Settings</span>
        </Link>

        {/* Logout Circular Button */}
        <button
          type="button"
          onClick={handleLogout}
          className={`${styles.dockCircle} ${styles.inactiveCircle} ${styles.logoutCircle}`}
          aria-label="Log Out"
          title="Log Out"
        >
          <div className={styles.iconContainer}>
            <LogOut size={18} strokeWidth={2} />
          </div>
          <span className={styles.dockTooltip}>Log Out</span>
        </button>
      </div>
    </nav>
  );
};
