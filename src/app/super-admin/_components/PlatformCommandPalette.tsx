"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, Settings } from "lucide-react";
import styles from "@/components/navigation/CommandPalette.module.css";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import { platformRequest } from "../_lib/platform-client";
import { visibleModules, SETTINGS_PATH } from "../_lib/console-modules";
import { canAccessPlatformPath, CONSOLE_ROOT } from "../_lib/platform-module-access";
import { humanize } from "../_lib/format";

interface Command {
  id: string;
  title: string;
  category: string;
  icon: React.ReactNode;
  href: string;
}

interface TenantHit {
  id: string;
  name: string;
  slug?: string;
  status?: string;
}

/** ⌘K for the console: jump to a module the role can open, or find a tenant by name/slug through the tenants API. */
export const PlatformCommandPalette: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  permissions: readonly string[];
}> = ({ isOpen, onClose, permissions }) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [tenants, setTenants] = useState<TenantHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const canSearchTenants = permissions.includes(PLATFORM_PERMISSIONS.TENANT_READ);

  const moduleCommands = useMemo<Command[]>(() => {
    const list: Command[] = visibleModules(permissions).map((m) => ({
      id: `module:${m.href}`,
      title: m.label,
      category: m.description,
      icon: m.icon,
      href: m.href,
    }));
    if (canAccessPlatformPath(SETTINGS_PATH, permissions)) {
      list.push({ id: "module:settings", title: "Settings", category: "Platform settings", icon: <Settings size={18} />, href: SETTINGS_PATH });
    }
    return list;
  }, [permissions]);

  // Tenant search through the API, debounced; only for roles that can read tenants
  useEffect(() => {
    if (!isOpen || !canSearchTenants) return;
    const q = query.trim();
    if (q.length < 2) {
      setTenants([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      platformRequest<TenantHit[]>(`/api/v1/platform/tenants?search=${encodeURIComponent(q)}&limit=8`)
        .then((res) => {
          if (!cancelled) {
            setTenants(Array.isArray(res.data) ? res.data : []);
            setSearchError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setSearchError(err instanceof Error ? err.message : "Tenant search failed.");
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, isOpen, canSearchTenants]);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const modules = q ? moduleCommands.filter((c) => c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)) : moduleCommands;
    const tenantCommands: Command[] = tenants.map((t) => ({
      id: `tenant:${t.id}`,
      title: t.name,
      category: [t.slug, t.status ? humanize(t.status) : null].filter(Boolean).join(" · ") || "Tenant",
      icon: <Building2 size={18} />,
      href: `${CONSOLE_ROOT}/tenants/${encodeURIComponent(t.id)}`,
    }));
    return [...tenantCommands, ...modules];
  }, [query, moduleCommands, tenants]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelected(0);
      setTenants([]);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const go = (cmd: Command) => {
    router.push(cmd.href);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, Math.max(commands.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && commands[selected]) {
        e.preventDefault();
        go(commands[selected]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, commands, selected]);

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Console search">
        <div className={styles.searchHeader}>
          <Search size={20} />
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder={canSearchTenants ? "Search tenants or jump to a module…" : "Jump to a module…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
        </div>

        <div className={styles.commandList} role="listbox">
          {searchError && <div className={styles.footer}>{searchError}</div>}
          {commands.length === 0 ? (
            <div className={styles.footer}>Nothing matches &quot;{query}&quot;.</div>
          ) : (
            commands.map((cmd, index) => (
              <div
                key={cmd.id}
                role="option"
                aria-selected={index === selected}
                className={`${styles.commandItem} ${index === selected ? styles.selected : ""}`}
                onClick={() => go(cmd)}
                onMouseEnter={() => setSelected(index)}
              >
                <div className={styles.commandLeft}>
                  {cmd.icon}
                  <span>{cmd.title}</span>
                </div>
                <span className={styles.footerKbd}>{cmd.category}</span>
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span>Platform console</span>
          <div className={styles.footerKbd}>
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>ESC Close</span>
          </div>
        </div>
      </div>
    </div>
  );
};
