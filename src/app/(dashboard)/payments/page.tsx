"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import { BentoCard } from "@/components/bento/BentoCard";
import { CreatePaymentLinkPanel } from "@/components/payments/CreatePaymentLinkPanel";
import { PaymentLinksPanel, type PaymentLinkView } from "@/components/payments/PaymentLinksPanel";
import { PaymentMethodsPanel } from "@/components/payments/PaymentMethodsPanel";
import { ConfirmedPaymentsPanel, PaymentsReviewPanel } from "@/components/payments/PaymentsReviewPanel";
import { PaymentsSummary } from "@/components/payments/PaymentsSummary";
import { api, type ApiFailure } from "@/components/payments/api";
import { PERMISSIONS } from "@/lib/permissions";
import type { Payment } from "@/types/commerce";
import legacy from "@/components/payments/Payments.module.css";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";

interface SessionInfo {
  permissions?: string[];
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

/**
 * Customer payments for this shop (ADR-123): what needs confirming first, then payment links, confirmed payments and
 * how the shop gets paid. The subscription this workspace pays CommerceOS lives under Settings → Billing.
 */
export default function PaymentsPage() {
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [links, setLinks] = useState<PaymentLinkView[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<(ApiFailure & { status: number }) | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [linkResult, paymentResult] = await Promise.all([
      api<{ links: PaymentLinkView[] }>("/api/v1/payments/links"),
      api<{ payments: Payment[] }>("/api/v1/payments"),
    ]);
    const failed = !linkResult.ok ? linkResult : !paymentResult.ok ? paymentResult : null;
    if (failed?.error) {
      setLoadError({ ...failed.error, status: failed.status });
    } else {
      setLoadError(null);
      setLinks(linkResult.data?.links ?? []);
      setPayments(paymentResult.data?.payments ?? []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void api<SessionInfo>("/api/v1/auth/session").then((result) => setPermissions(result.data?.permissions ?? []));
    void load();
  }, [load]);

  const can = (permission: string) => Boolean(permissions?.includes(permission));
  const canCreate = can(PERMISSIONS.ORDERS_WRITE);
  const ready = loaded && permissions !== null && !loadError;

  // "C" opens the new-link panel, like other keyboard-first tools
  useEffect(() => {
    if (!canCreate) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      setCreating(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCreate]);

  const closeCreate = useCallback(() => setCreating(false), []);
  const orderNumbers = Object.fromEntries(links.map((link) => [link.order_id, link.order_number]));

  return (
    <div className={ws.page}>
      <header className={ws.header}>
        <div>
          <h1 className={ws.title}>Payments</h1>
          <p className={ws.subtitle}>
            bKash, Nagad, Rocket, cards and internet banking from your customers. Paying for CommerceOS? Go to{" "}
            <Link href="/settings/billing">Billing</Link>.
          </p>
        </div>
        {canCreate && (
          <button type="button" className={ws.inkButton} onClick={() => setCreating(true)} disabled={!ready}>
            <Plus size={16} /> New payment link <span className={ws.kbd}>C</span>
          </button>
        )}
      </header>

      {!loaded || permissions === null ? (
        <BentoCard span={12}>
          <LoadingSkeleton lines={5} inline />
        </BentoCard>
      ) : loadError ? (
        <BentoCard span={12}>
          {loadError.status === 403 ? (
            <PermissionDenied resource="payments" requiredPermission={PERMISSIONS.PAYMENTS_READ} inline />
          ) : (
            <ErrorState message={loadError.message} requestId={loadError.request_id} onRetry={() => void load()} inline />
          )}
        </BentoCard>
      ) : (
        <>
          <PaymentsSummary payments={payments} links={links} />
          <PaymentsReviewPanel payments={payments} orderNumbers={orderNumbers} canVerify={can(PERMISSIONS.PAYMENTS_VERIFY)} onChanged={load} />
          <PaymentLinksPanel links={links} canCreate={canCreate} onChanged={load} />
          <ConfirmedPaymentsPanel payments={payments} orderNumbers={orderNumbers} />
        </>
      )}

      {permissions !== null && can(PERMISSIONS.SETTINGS_READ) && (
        <div className={legacy.grid}>
          <PaymentMethodsPanel canEdit={can(PERMISSIONS.SETTINGS_UPDATE)} />
        </div>
      )}

      {creating && <CreatePaymentLinkPanel onClose={closeCreate} onCreated={load} />}
    </div>
  );
}
