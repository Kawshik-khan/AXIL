"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Bell, LogOut, Settings, UserCheck, Shield, Sun, Moon, ChevronDown } from "lucide-react";
import { useMerchantTheme } from "./merchant-theme";
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
  const { theme, toggle: toggleTheme } = useMerchantTheme();

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

  // A colour of their own for each person, the same on every visit (hue from the name)
  const hue = [...userName].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const avatarStyle = { background: `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 48) % 360} 68% 34%))` };
  const roleLabel = userRole.charAt(0).toUpperCase() + userRole.slice(1).toLowerCase().replace(/_/g, " ");

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
        <button
          type="button"
          className={styles.iconButton}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

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
            <span className={styles.avatar} style={avatarStyle} aria-hidden="true">
              {initials}
            </span>
            <span className={styles.profileText}>
              <span className={styles.userName}>{userName}</span>
              <span className={styles.userRole}>{roleLabel}</span>
            </span>
            <ChevronDown size={16} className={`${styles.chevron} ${isDropdownOpen ? styles.chevronOpen : ""}`} aria-hidden="true" />
          </button>

          {isDropdownOpen && (
            <div className={styles.dropdown} role="menu">
              <div className={styles.dropdownHeader}>
                <span className={`${styles.avatar} ${styles.avatarLarge}`} style={avatarStyle} aria-hidden="true">
                  {initials}
                </span>
                <span className={styles.profileText}>
                  <span className={styles.userName}>{userName}</span>
                  <span className={styles.userRole}>
                    {roleLabel} · {tenantName}
                  </span>
                </span>
              </div>
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
