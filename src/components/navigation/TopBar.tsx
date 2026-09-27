"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Bell, LogOut, Settings, UserCheck, Shield } from "lucide-react";
import { Badge } from "../ui/Badge/Badge";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  tenantName?: string;
  userName?: string;
  userRole?: string;
  onOpenCommandPalette?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  tenantName = "Dhaka D2C Apparel",
  userName = "Rafiqul Islam",
  userRole = "OWNER",
  onOpenCommandPalette,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <header className={styles.topBar}>
      <div className={styles.leftSection}>
        <div className={styles.tenantBadge} title="Active Workspace">
          <span className={styles.tenantIcon}>🏢</span>
          <span>{tenantName}</span>
        </div>
      </div>

      <div className={styles.centerSection}>
        <button
          className={styles.searchTrigger}
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
        >
          <span className={styles.searchPlaceholder}>
            <Search size={16} />
            <span>Search or type a command...</span>
          </span>
          <span className={styles.kbdShortcut}>⌘K</span>
        </button>
      </div>

      <div className={styles.rightSection}>
        <Link
          href="/super-admin"
          className={styles.platformBadge}
          title="Switch to SaaS Platform Control Plane (Super Admin Scope)"
        >
          <Shield size={13} />
          <span>Platform Control</span>
        </Link>

        <div className={styles.aiIndicator} title="✦ CommerceOS Agent Gateway Active">
          <span className={styles.aiDot} />
          <span>✦ AI Ready</span>
        </div>

        <button className={styles.iconButton} aria-label="Notifications" title="System Alerts">
          <Bell size={18} />
          <span className={styles.notificationBadge} />
        </button>

        <div className={styles.profileMenuWrapper} ref={dropdownRef}>
          <button
            className={styles.profileButton}
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            aria-expanded={isDropdownOpen}
            aria-haspopup="true"
          >
            <div className={styles.avatar}>{initials}</div>
            <span className={styles.userName}>{userName}</span>
            <Badge variant={userRole.toLowerCase() as any}>{userRole}</Badge>
          </button>

          {isDropdownOpen && (
            <div className={styles.dropdown} role="menu">
              <div style={{ padding: "8px 12px" }}>
                <p style={{ fontWeight: 600, fontSize: "13px" }}>{userName}</p>
                <p style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Role: {userRole}</p>
              </div>
              <div className={styles.dropdownDivider} />
              <Link
                href="/super-admin"
                className={styles.dropdownItem}
                onClick={() => setIsDropdownOpen(false)}
                role="menuitem"
                style={{ fontWeight: 600 }}
              >
                <Shield size={16} />
                <span>SaaS Control Plane (Platform)</span>
              </Link>
              <div className={styles.dropdownDivider} />
              <Link
                href="/settings"
                className={styles.dropdownItem}
                onClick={() => setIsDropdownOpen(false)}
                role="menuitem"
              >
                <Settings size={16} />
                <span>Workspace Settings</span>
              </Link>
              <Link
                href="/settings#users"
                className={styles.dropdownItem}
                onClick={() => setIsDropdownOpen(false)}
                role="menuitem"
              >
                <UserCheck size={16} />
                <span>Team Members</span>
              </Link>
              <Link
                href="/settings#security"
                className={styles.dropdownItem}
                onClick={() => setIsDropdownOpen(false)}
                role="menuitem"
              >
                <Shield size={16} />
                <span>Security & Audit</span>
              </Link>
              <div className={styles.dropdownDivider} />
              <button
                className={styles.dropdownItem}
                style={{ color: "var(--color-danger)" }}
                onClick={handleLogout}
                role="menuitem"
              >
                <LogOut size={16} />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
