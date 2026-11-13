"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import type { PlatformInvoiceView } from "@/domains/platform/services/platform-billing.service";
import { usePlatformResource } from "../../_lib/use-platform-resource";
import { platformRequest } from "../../_lib/platform-client";
import { formatDateTime, formatMoney, humanize } from "../../_lib/format";
import { CONSOLE_ROOT } from "../../_lib/platform-module-access";
import { ResourceView } from "../../_components/ResourceView";
import { StatusPill } from "../../_components/StatusPill";
import { PrivilegedActionDialog } from "../../_components/PrivilegedActionDialog";
import styles from "../../super-admin.module.css";

type Decision = { kind: "verify" | "reject"; invoice: PlatformInvoiceView } | null;

const METHOD: Record<string, string> = {
  SSLCOMMERZ: "SSLCommerz",
  BKASH: "bKash checkout",
  MANUAL_BKASH: "bKash (sent by hand)",
  MANUAL_NAGAD: "Nagad (sent by hand)",
  MANUAL_BANK: "Bank transfer",
};

/**
 * Subscription invoices of every workspace (ADR-123). Payments sent by hand wait here: an operator finds the
 * transfer in the platform's own bKash / Nagad / bank statement and confirms it, which is what applies the plan.
 * Gateway payments confirm themselves and only appear in the history.
 */
export function InvoiceQueue({ canManage }: { canManage: boolean }) {
  const invoices = usePlatformResource<{ invoices: PlatformInvoiceView[] }>("/api/v1/platform/billing/invoices", {
    isEmpty: (d) => d.invoices.length === 0,
  });
  const [decision, setDecision] = useState<Decision>(null);

  return (
    <>
      <BentoCard
        span={12}
        title="Invoices"
        subtitle="Confirm a payment only after finding the transaction ID and amount in the platform's own statement"
      >
        <ResourceView
          state={invoices.state}
          onRetry={invoices.reload}
          resource="invoices"
          emptyFigure="empty-list"
          emptyTitle="No invoices"
          emptyDescription="Invoices appear when a workspace chooses a plan on its Billing page."
          renderReady={({ invoices: rows }) => {
            const pending = rows.filter((i) => i.status === "PENDING_VERIFICATION");
            const rest = rows.filter((i) => i.status !== "PENDING_VERIFICATION");
            return (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Tenant</th>
                      <th>Plan</th>
                      <th className={styles.numeric}>Amount</th>
                      <th>Status</th>
                      <th>Method</th>
                      <th>Transaction ID</th>
                      <th>Submitted / paid</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...pending, ...rest].map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.invoice_number}</td>
                        <td>
                          <Link href={`${CONSOLE_ROOT}/tenants/${encodeURIComponent(invoice.tenant_id)}?tab=commercial`}>
                            {invoice.tenant_name ?? invoice.tenant_id}
                          </Link>
                        </td>
                        <td>
                          {invoice.plan_name ?? invoice.plan_id} · {humanize(invoice.billing_period)}
                        </td>
                        <td className={styles.numeric}>{formatMoney(invoice.amount_bdt, "BDT")}</td>
                        <td>
                          <StatusPill
                            status={invoice.status}
                            tone={invoice.status === "PAID" ? "ok" : invoice.status === "VOID" ? "neutral" : "warn"}
                            label={invoice.status === "PENDING_VERIFICATION" ? "Needs checking" : invoice.status === "ISSUED" ? "Unpaid" : undefined}
                          />
                          {invoice.test_mode && <StatusPill status="TEST" tone="simulated" label="Sandbox" />}
                        </td>
                        <td>{invoice.payment_method ? METHOD[invoice.payment_method] ?? invoice.payment_method : "—"}</td>
                        <td>{invoice.manual_transaction_id ?? invoice.payment_reference ?? "—"}</td>
                        <td>{formatDateTime(invoice.paid_at ?? invoice.manual_submitted_at)}</td>
                        <td>
                          {invoice.status === "PENDING_VERIFICATION" && canManage && (
                            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                              <Button size="sm" onClick={() => setDecision({ kind: "verify", invoice })}>
                                Confirm payment
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDecision({ kind: "reject", invoice })}>
                                Not found
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        />
      </BentoCard>

      {decision && (
        <PrivilegedActionDialog
          open
          onClose={() => setDecision(null)}
          actionKey={decision.kind === "verify" ? "billing.verify_payment" : "billing.reject_payment"}
          target={{ type: "tenant", id: decision.invoice.tenant_id, label: `${decision.invoice.invoice_number} · ${decision.invoice.tenant_name ?? decision.invoice.tenant_id}` }}
          submitLabel={decision.kind === "verify" ? "Confirm payment" : "Reject payment"}
          execute={async (a) =>
            (
              await platformRequest(`/api/v1/platform/billing/invoices/${encodeURIComponent(decision.invoice.id)}/${decision.kind}`, {
                method: "POST",
                json: { reason: a.reason },
              })
            ).data
          }
          onDone={() => {
            setDecision(null);
            invoices.reload();
          }}
        >
          <p>
            {decision.kind === "verify"
              ? `Confirming applies the plan to this workspace. Do it only after you found ${formatMoney(decision.invoice.amount_bdt, "BDT")} with transaction ID ${decision.invoice.manual_transaction_id ?? ""} (${METHOD[decision.invoice.payment_method ?? ""] ?? "manual"}) in the platform's own statement. In the reason, say where you saw it.`
              : "Rejecting makes the invoice payable again and shows your reason to the workspace."}
          </p>
        </PrivilegedActionDialog>
      )}
    </>
  );
}
