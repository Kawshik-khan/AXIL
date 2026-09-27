"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Target,
  Scale,
  Bot,
  GraduationCap,
  Activity,
  ShieldAlert,
} from "lucide-react";
import styles from "../autonomous.module.css";

export function AutonomousNav() {
  const pathname = usePathname();

  const tabs = [
    { href: "/autonomous", label: "Control Tower", icon: Sparkles },
    { href: "/autonomous/objectives", label: "Objectives", icon: Target },
    { href: "/autonomous/decisions", label: "Decisions", icon: Scale },
    { href: "/autonomous/agents", label: "Agents", icon: Bot },
    { href: "/autonomous/learning", label: "Learning & Models", icon: GraduationCap },
    { href: "/autonomous/health", label: "System Health", icon: Activity },
    { href: "/autonomous/governance", label: "Governance & Safety", icon: ShieldAlert },
  ];

  return (
    <div className={styles.subnav}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.href === "/autonomous"
            ? pathname === "/autonomous"
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.tabLink} ${isActive ? styles.tabActive : ""}`}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
