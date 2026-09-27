"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  Settings,
  Users,
  Shield,
  FileText,
  TrendingUp,
  Sparkles,
  Sliders,
  LogOut,
  Rocket,
  Send,
  GitFork,
  Workflow,
  PlugZap,
  Layers,
  Flame,
  Building2,
} from "lucide-react";
import styles from "./CommandPalette.module.css";
import { canAccessPath } from "./module-access";

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** Tenant permissions of the signed-in user; commands for modules the role can't use are hidden. */
  permissions?: string[];
}

interface Command {
  id: string;
  title: string;
  category: string;
  icon: React.ReactNode;
  href?: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, permissions }) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    {
      id: "nav-overview",
      title: "Go to Dashboard Overview",
      category: "Navigation",
      icon: <LayoutDashboard size={18} />,
      href: "/",
      action: () => {
        router.push("/");
        onClose();
      },
    },
    {
      id: "nav-connectors",
      title: "Go to Connectors & Integrations Hub",
      category: "Integrations",
      icon: <PlugZap size={18} />,
      href: "/connector",
      action: () => {
        router.push("/connector");
        onClose();
      },
    },
    {
      id: "nav-connectors-ai",
      title: "Connect AI & LLM Models (OpenAI, Claude, Gemini, Ollama)",
      category: "Integrations",
      icon: <Sparkles size={18} />,
      href: "/connector?category=AI_LLM",
      action: () => {
        router.push("/connector?category=AI_LLM");
        onClose();
      },
    },
    {
      id: "nav-connectors-vectordb",
      title: "Connect Vector Database for RAG (Qdrant, Pinecone, ChromaDB, pgvector)",
      category: "Integrations",
      icon: <Layers size={18} />,
      href: "/connector?category=VECTOR_DB",
      action: () => {
        router.push("/connector?category=VECTOR_DB");
        onClose();
      },
    },
    {
      id: "nav-connectors-redis",
      title: "Connect Redis & Distributed Cache (Self-Hosted, Upstash, Redis Cloud)",
      category: "Integrations",
      icon: <Flame size={18} />,
      href: "/connector?category=REDIS_CACHE",
      action: () => {
        router.push("/connector?category=REDIS_CACHE");
        onClose();
      },
    },
    {
      id: "nav-connectors-social",
      title: "Connect Social Media & Ads (Meta, WhatsApp, Google Ads)",
      category: "Integrations",
      icon: <Send size={18} />,
      href: "/connector?category=SOCIAL_ADS",
      action: () => {
        router.push("/connector?category=SOCIAL_ADS");
        onClose();
      },
    },
    {
      id: "nav-connectors-couriers",
      title: "Connect Parcel Delivery & Couriers (Steadfast, Pathao, RedX)",
      category: "Integrations",
      icon: <PlugZap size={18} />,
      href: "/connector?category=LOGISTICS",
      action: () => {
        router.push("/connector?category=LOGISTICS");
        onClose();
      },
    },
    {
      id: "nav-connectors-database",
      title: "Connect Cloud / Self-Hosted Database (Supabase, Neon, Postgres)",
      category: "Integrations",
      icon: <PlugZap size={18} />,
      href: "/connector?category=DATABASE",
      action: () => {
        router.push("/connector?category=DATABASE");
        onClose();
      },
    },
    {
      id: "nav-connectors-enterprise",
      title: "Connect Enterprise Systems & ERP (SAP S/4HANA, NetSuite, Salesforce, Daraz)",
      category: "Integrations",
      icon: <Building2 size={18} />,
      href: "/connector?category=ENTERPRISE",
      action: () => {
        router.push("/connector?category=ENTERPRISE");
        onClose();
      },
    },
    {
      id: "nav-automations",
      title: "Go to Automations & n8n Hub",
      category: "Automation",
      icon: <Workflow size={18} />,
      href: "/automations",
      action: () => {
        router.push("/automations");
        onClose();
      },
    },
    {
      id: "nav-automation-catalog",
      title: "Browse 39 Workflow Templates Catalog",
      category: "Automation",
      icon: <Workflow size={18} />,
      href: "/automations",
      action: () => {
        router.push("/automations");
        onClose();
      },
    },
    {
      id: "nav-automation-dlq",
      title: "Inspect Dead Letter Queue (DLQ)",
      category: "Automation",
      icon: <Workflow size={18} />,
      href: "/automations",
      action: () => {
        router.push("/automations");
        onClose();
      },
    },
    {
      id: "nav-growth",
      title: "Go to Growth Command Center",
      category: "Growth & Marketing",
      icon: <Rocket size={18} />,
      href: "/growth",
      action: () => {
        router.push("/growth");
        onClose();
      },
    },
    {
      id: "nav-growth-campaigns",
      title: "Launch / Manage Growth Campaigns",
      category: "Growth & Marketing",
      icon: <Send size={18} />,
      href: "/growth/campaigns",
      action: () => {
        router.push("/growth/campaigns");
        onClose();
      },
    },
    {
      id: "nav-growth-journeys",
      title: "Customer Lifecycle Automated Journeys",
      category: "Growth & Marketing",
      icon: <GitFork size={18} />,
      href: "/growth/journeys",
      action: () => {
        router.push("/growth/journeys");
        onClose();
      },
    },
    {
      id: "nav-growth-audiences",
      title: "Audience Segments & Predictive Cohorts",
      category: "Growth & Marketing",
      icon: <Users size={18} />,
      href: "/growth/audiences",
      action: () => {
        router.push("/growth/audiences");
        onClose();
      },
    },
    {
      id: "nav-intelligence",
      title: "Go to Commerce Intelligence Overview",
      category: "Intelligence",
      icon: <Sparkles size={18} />,
      href: "/intelligence",
      action: () => {
        router.push("/intelligence");
        onClose();
      },
    },
    {
      id: "nav-forecasts",
      title: "Predictive Demand & Revenue Forecasts",
      category: "Intelligence",
      icon: <TrendingUp size={18} />,
      href: "/intelligence/forecasts",
      action: () => {
        router.push("/intelligence/forecasts");
        onClose();
      },
    },
    {
      id: "nav-simulation",
      title: "Simulate What-If Scenarios (Price, Stock, Discounts)",
      category: "Intelligence",
      icon: <Sliders size={18} />,
      href: "/intelligence/simulation",
      action: () => {
        router.push("/intelligence/simulation");
        onClose();
      },
    },
    {
      id: "nav-analytics-nl",
      title: "Ask AI Analytics in Natural Language",
      category: "Intelligence",
      icon: <Sparkles size={18} />,
      href: "/intelligence/analytics",
      action: () => {
        router.push("/intelligence/analytics");
        onClose();
      },
    },
    {
      id: "nav-orders",
      title: "Go to Orders Management",
      category: "Commerce",
      icon: <FileText size={18} />,
      href: "/orders",
      action: () => {
        router.push("/orders");
        onClose();
      },
    },
    {
      id: "nav-products",
      title: "Go to Product Catalog & SKUs",
      category: "Commerce",
      icon: <FileText size={18} />,
      href: "/products",
      action: () => {
        router.push("/products");
        onClose();
      },
    },
    {
      id: "nav-inventory",
      title: "Go to Inventory & Warehouses",
      category: "Commerce",
      icon: <FileText size={18} />,
      href: "/inventory",
      action: () => {
        router.push("/inventory");
        onClose();
      },
    },
    {
      id: "nav-shipments",
      title: "Go to Logistics & Courier Shipments",
      category: "Commerce",
      icon: <FileText size={18} />,
      href: "/shipments",
      action: () => {
        router.push("/shipments");
        onClose();
      },
    },
    {
      id: "nav-customers",
      title: "Go to Customer Directory",
      category: "Commerce",
      icon: <Users size={18} />,
      href: "/customers",
      action: () => {
        router.push("/customers");
        onClose();
      },
    },
    {
      id: "nav-settings",
      title: "Go to Workspace Settings",
      category: "Settings",
      icon: <Settings size={18} />,
      href: "/settings",
      action: () => {
        router.push("/settings");
        onClose();
      },
    },
    {
      id: "nav-users",
      title: "Manage Team Members",
      category: "Settings",
      icon: <Users size={18} />,
      href: "/settings#users",
      action: () => {
        router.push("/settings#users");
        onClose();
      },
    },
    {
      id: "nav-security",
      title: "View Security & Audit Logs",
      category: "Security",
      icon: <Shield size={18} />,
      href: "/settings#security",
      action: () => {
        router.push("/settings#security");
        onClose();
      },
    },
    {
      id: "doc-agents",
      title: "Read Agent Operating Rules",
      category: "Documentation",
      icon: <FileText size={18} />,
      action: () => {
        window.open("https://github.com", "_blank");
        onClose();
      },
    },
    {
      id: "auth-logout",
      title: "Log out from CommerceOS",
      category: "Account",
      icon: <LogOut size={18} />,
      action: async () => {
        try {
          await fetch("/api/v1/auth/logout", { method: "POST" });
        } catch {}
        router.push("/login");
        onClose();
      },
    },
  ];

  const filtered = commands.filter(
    (cmd) =>
      (!cmd.href || canAccessPath(cmd.href, permissions)) &&
      (cmd.title.toLowerCase().includes(query.toLowerCase()) || cmd.category.toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <Search size={20} />
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
        </div>

        <div className={styles.commandList}>
          {filtered.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted)" }}>
              No commands matching &quot;{query}&quot;
            </div>
          ) : (
            filtered.map((cmd, index) => (
              <div
                key={cmd.id}
                className={`${styles.commandItem} ${index === selectedIndex ? styles.selected : ""}`}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className={styles.commandLeft}>
                  {cmd.icon}
                  <span>{cmd.title}</span>
                </div>
                <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                  {cmd.category}
                </span>
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span>CommerceOS Command Control</span>
          <div className={styles.footerKbd}>
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
        </div>
      </div>
    </div>
  );
};
