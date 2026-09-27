"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  GitBranch,
  BarChart3,
  Scale,
  Cpu,
  Code2,
  ShieldCheck,
} from "lucide-react";
import styles from "../enterprise.module.css";

export function EnterpriseNav() {
  const pathname = usePathname();

  const tabs = [
    { href: "/enterprise", label: "Overview", icon: Building2 },
    { href: "/enterprise/hierarchy", label: "Hierarchy & Stores", icon: GitBranch },
    { href: "/enterprise/analytics", label: "Analytics & KPIs", icon: BarChart3 },
    { href: "/enterprise/benchmarks", label: "Benchmarks", icon: Scale },
    { href: "/enterprise/integrations", label: "Integrations Hub", icon: Cpu },
    { href: "/enterprise/developer", label: "Developer Platform", icon: Code2 },
    { href: "/enterprise/governance", label: "Governance & Quality", icon: ShieldCheck },
  ];

  return (
    <div className={styles.subnav}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive =
          tab.href === "/enterprise"
            ? pathname === "/enterprise"
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
