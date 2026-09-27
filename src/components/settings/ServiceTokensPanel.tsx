"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { Badge } from "@/components/ui/Badge/Badge";
import dashStyles from "@/app/(dashboard)/dashboard.module.css";

interface ServiceTokenView {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at?: string;
  expires_at?: string;
  revoked_at?: string;
}

/** Scopes a service token can hold (mirrors SERVICE_TOKEN_SCOPES in src/lib/permissions.ts). */
const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "inventory.adjust", label: "Adjust stock" },
  { value: "orders.update", label: "Confirm / cancel orders" },
  { value: "orders.read", label: "Read orders" },
  { value: "shipments.create", label: "Create shipments" },
  { value: "notifications.send", label: "Send notifications" },
  { value: "products.create", label: "Bulk-create products" },
  { value: "products.read", label: "Read products" },
];

const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");

/**
 * Service tokens for automation callers such as n8n (FIX_IMPLEMENTATION_PLAN FX-18).
 * A new token is shown once; only its prefix is kept for display afterwards.
 */
export function ServiceTokensPanel() {
  const [tokens, setTokens] = useState<ServiceTokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("n8n automations");
  const [scopes, setScopes] = useState<string[]>(["notifications.send"]);
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/service-tokens", { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || "Could not load service tokens.");
      setTokens(body.data.service_tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load service tokens.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNewToken(null);
    try {
      const days = Number(expiresInDays);
      const res = await fetch("/api/v1/service-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), scopes, ...(days > 0 ? { expires_in_days: days } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || "Could not create the token.");
      setNewToken(body.data.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this token? Anything using it stops working immediately.")) return;
    const res = await fetch(`/api/v1/service-tokens/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message || "Could not revoke the token.");
      return;
    }
    await load();
  };

  const toggleScope = (value: string) =>
    setScopes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Service tokens</h3>
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          Credentials for automations such as n8n. Send one as <code>Authorization: Bearer cos_svc_…</code>. A token can
          only do what its scopes allow in this workspace.
        </p>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: "13px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {newToken && (
        <div role="status" style={{ padding: "12px", borderRadius: "var(--radius-sm)", background: "var(--color-success-bg)" }}>
          <p style={{ fontSize: "13px", fontWeight: 600 }}>Copy this token now. It won&apos;t be shown again.</p>
          <code style={{ wordBreak: "break-all", fontSize: "13px" }}>{newToken}</code>
        </div>
      )}

      <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <fieldset style={{ border: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <legend style={{ fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>Scopes</legend>
          {SCOPE_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
              <input type="checkbox" checked={scopes.includes(option.value)} onChange={() => toggleScope(option.value)} />
              {option.label}
            </label>
          ))}
        </fieldset>
        <Input
          label="Expires after (days, empty = never)"
          type="number"
          min={1}
          max={3650}
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(e.target.value)}
        />
        <div>
          <Button type="submit" variant="primary" isLoading={creating} disabled={scopes.length === 0 || !name.trim()}>
            Create service token
          </Button>
        </div>
      </form>

      <div className={dashStyles.tableContainer}>
        <table className={dashStyles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Token</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>Loading…</td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={7}>No service tokens yet.</td>
              </tr>
            ) : (
              tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td style={{ fontFamily: "monospace" }}>{t.key_prefix}…</td>
                  <td>{t.scopes.join(", ")}</td>
                  <td>{formatDate(t.last_used_at)}</td>
                  <td>{formatDate(t.expires_at)}</td>
                  <td>{t.revoked_at ? <Badge variant="deactivated">Revoked</Badge> : <Badge variant="active">Active</Badge>}</td>
                  <td>
                    {!t.revoked_at && (
                      <Button type="button" variant="secondary" onClick={() => handleRevoke(t.id)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
