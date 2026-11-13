"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Modal } from "@/components/ui/Modal/Modal";
import type { Payment } from "@/types/commerce";
import { api, formatBdt, formatDateTime } from "./api";
import { METHOD_NAMES, MethodMark, timeAgo } from "./payment-ui";
import { awaitingConfirmation } from "./PaymentsSummary";
import styles from "./PaymentsPage.module.css";
import ws from "@/components/ui/WorkScreen/WorkScreen.module.css";
import legacy from "./Payments.module.css";

/** What bKash said about a submitted TrxID (ADR-124): advice for staff, not a confirmation. */
function checkLine(check: NonNullable<Payment["gateway_check"]>): { label: string; tone: "ok" | "bad" | "neutral" } {
  const sandbox = check.mode === "SANDBOX" ? " (sandbox)" : "";
  switch (check.result) {
    case "MATCHED":
      return { label: `Found in your bKash account${sandbox}`, tone: "ok" };
    case "UNAVAILABLE":
      return { label: "bKash could not be reached", tone: "neutral" };
    case "BEFORE_LINK":
      return { label: `Paid before the link was made${sandbox}`, tone: "bad" };
    case "SENDER_MISMATCH":
      return { label: `Sent from a different number${sandbox}`, tone: "bad" };
    case "AMOUNT_MISMATCH":
      return { label: `Different amount in bKash${sandbox}`, tone: "bad" };
    case "NOT_COMPLETED":
      return { label: `Not completed in bKash${sandbox}`, tone: "bad" };
    default:
      return { label: `Not found in bKash${sandbox}`, tone: "bad" };
  }
}

function CheckResult({ check }: { check: NonNullable<Payment["gateway_check"]> }) {
  const line = checkLine(check);
  const className = line.tone === "ok" ? styles.checkOk : line.tone === "bad" ? styles.checkBad : styles.checkNeutral;
  const Icon = line.tone === "ok" ? CheckCircle2 : line.tone === "bad" ? AlertTriangle : CircleDashed;
  return (
    <div className={`${styles.check} ${className}`} title={`${check.message} Checked ${formatDateTime(check.checked_at)}.`}>
      <Icon size={13} /> {line.label}
    </div>
  );
}

/** The queue shows the newest few; the rest are one click away so links and history stay on screen. */
const QUEUE_PREVIEW = 6;

function confirmedBy(payment: Payment): string {
  if (payment.verified_by === "gateway:BKASH_LOOKUP") return "bKash lookup";
  if (payment.verification_method === "GATEWAY") return "Gateway";
  if (payment.verification_method === "MANUAL") return "Staff";
  return "Recorded";
}

/** The 25 most recent payments confirmed by staff or a gateway. Read-only. */
export function ConfirmedPaymentsPanel({ payments, orderNumbers }: { payments: Payment[]; orderNumbers: Record<string, string> }) {
  const confirmed = payments.filter((p) => p.status === "PAID").slice(0, 25);
  return (
    <section className={ws.section} aria-labelledby="confirmed-title">
      <div className={ws.sectionHead}>
        <div>
          <h2 id="confirmed-title" className={ws.sectionTitle}>
            Confirmed payments
          </h2>
          <p className={ws.sectionHint}>The 25 most recent, confirmed by your team or by a gateway.</p>
        </div>
      </div>
      {confirmed.length === 0 ? (
        <div className={ws.empty}>
          <p className={ws.emptyTitle}>No confirmed payments yet</p>
          <p className={ws.emptyText}>Payments you confirm, and payments a gateway confirms, are listed here.</p>
        </div>
      ) : (
        <div className={ws.tableScroll}>
          <table className={ws.table}>
            <thead>
              <tr>
                <th>Order</th>
                <th>Method</th>
                <th>Transaction ID</th>
                <th className={ws.numeric}>Amount</th>
                <th>Confirmed</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {confirmed.map((payment) => (
                <tr key={payment.id}>
                  <td className={ws.orderNumber}>{orderNumbers[payment.order_id] ?? payment.order_id}</td>
                  <td>
                    <span className={styles.methodCell}>
                      <MethodMark provider={payment.provider} small />
                      {METHOD_NAMES[payment.provider] ?? payment.provider}
                    </span>
                  </td>
                  <td className={styles.trx}>{payment.transaction_id ?? "-"}</td>
                  <td className={ws.numeric}>{formatBdt(payment.amount)}</td>
                  <td title={formatDateTime(payment.verified_at ?? payment.created_at)}>{timeAgo(payment.verified_at ?? payment.created_at)}</td>
                  <td>
                    <span className={ws.tag}>{confirmedBy(payment)}</span>{" "}
                    {payment.test_mode && <span className={`${ws.tag} ${ws.tagWarn}`}>TEST</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Transaction ids customers submitted, waiting for staff to check against the shop's own bKash / Nagad / Rocket
 * account. Nothing here is optimistic: a row changes only after the server answers.
 */
export function PaymentsReviewPanel({
  payments,
  orderNumbers,
  canVerify,
  onChanged,
}: {
  payments: Payment[];
  /** order id → order number, for the orders a payment link was made for. */
  orderNumbers: Record<string, string>;
  canVerify: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(false);

  const pending = awaitingConfirmation(payments);
  const visible = expanded ? pending : pending.slice(0, QUEUE_PREVIEW);
  const orderLabel = (p: Payment) => orderNumbers[p.order_id] ?? p.order_id;

  const verify = async (payment: Payment) => {
    setError(null);
    setBusy(payment.id);
    const result = await api("/api/v1/payments/verify", { method: "POST", json: { payment_id: payment.id, transaction_id: payment.transaction_id } });
    setBusy(null);
    setConfirming(null);
    if (!result.ok) setError(result.error?.message ?? "Could not confirm the payment.");
    await onChanged();
  };

  const checkWithBkash = async (payment: Payment) => {
    setError(null);
    setBusy(`check:${payment.id}`);
    const result = await api(`/api/v1/payments/${encodeURIComponent(payment.id)}/check`, { method: "POST" });
    setBusy(null);
    if (!result.ok) setError(result.error?.message ?? "Could not check with bKash.");
    await onChanged();
  };

  const reject = async (payment: Payment) => {
    setError(null);
    setBusy(payment.id);
    const result = await api(`/api/v1/payments/${encodeURIComponent(payment.id)}/reject`, { method: "POST" });
    setBusy(null);
    if (!result.ok) setError(result.error?.message ?? "Could not reject the payment.");
    await onChanged();
  };

  return (
    <>
      <section className={ws.section} aria-labelledby="confirm-queue-title">
        <div className={ws.sectionHead}>
          <div>
            <h2 id="confirm-queue-title" className={ws.sectionTitle}>
              Needs your confirmation
              <span className={`${ws.count} ${pending.length ? ws.countHot : ""}`}>{pending.length}</span>
            </h2>
            <p className={ws.sectionHint}>Customers say they sent this money. Match the transaction ID and amount in your own wallet before confirming.</p>
          </div>
        </div>
        {error && (
          <div className={ws.notice} role="alert">
            {error}
          </div>
        )}
        {pending.length === 0 ? (
          <div className={ws.empty}>
            <p className={ws.emptyTitle}>You’re all caught up</p>
            <p className={ws.emptyText}>When a customer submits a bKash, Nagad or Rocket transaction ID on a payment link, it appears here.</p>
          </div>
        ) : (
          <div className={ws.sectionBody}>
            {visible.map((payment) => {
              const checked = payment.gateway_check;
              // A bKash ID not yet looked up: checking is the suggested first step; confirming stays available
              const checkFirst = payment.provider === "BKASH" && !checked;
              return (
                <div key={payment.id} className={styles.queueRow}>
                  <MethodMark provider={payment.provider} />
                  <div>
                    <div className={ws.primaryText}>{orderLabel(payment)}</div>
                    <div className={ws.secondaryText} title={formatDateTime(payment.created_at)}>
                      {METHOD_NAMES[payment.provider] ?? payment.provider} · {timeAgo(payment.created_at)}
                      {payment.payer_last4 ? ` · from …${payment.payer_last4}` : ""}
                    </div>
                  </div>
                  <div>
                    <span className={styles.trx}>{payment.transaction_id}</span>
                    {checked ? (
                      <CheckResult check={checked} />
                    ) : (
                      <div className={`${styles.check} ${styles.checkNeutral}`}>
                        <CircleDashed size={13} /> Not checked yet
                      </div>
                    )}
                  </div>
                  <div className={styles.bigAmount}>{formatBdt(payment.amount)}</div>
                  <div className={styles.actions}>
                    {canVerify ? (
                      <>
                        {payment.provider === "BKASH" && (
                          <button
                            type="button"
                            className={checkFirst ? ws.inkButtonSm : ws.quietButton}
                            disabled={busy !== null}
                            onClick={() => void checkWithBkash(payment)}
                          >
                            {busy === `check:${payment.id}` ? "Checking…" : checked ? "Check again" : "Check with bKash"}
                          </button>
                        )}
                        <button
                          type="button"
                          className={checkFirst ? ws.quietButton : ws.inkButtonSm}
                          disabled={busy !== null}
                          onClick={() => setConfirming(payment)}
                        >
                          Confirm
                        </button>
                        <button type="button" className={ws.textButton} disabled={busy !== null} onClick={() => void reject(payment)}>
                          {busy === payment.id ? "Rejecting…" : "Not received"}
                        </button>
                      </>
                    ) : (
                      <span className={ws.secondaryText}>Needs payments.verify</span>
                    )}
                  </div>
                </div>
              );
            })}
            {pending.length > QUEUE_PREVIEW && (
              <div className={styles.queueMore}>
                <button type="button" className={ws.textButton} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Show fewer" : `Show all ${pending.length}`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <Modal isOpen={confirming !== null} onClose={() => setConfirming(null)} title="Confirm you received this money">
        {confirming && (
          <div className={legacy.stack}>
            <p className={legacy.publicMeta}>
              Only confirm after you have seen <strong>{formatBdt(confirming.amount)}</strong> with transaction ID{" "}
              <span className={legacy.mono}>{confirming.transaction_id}</span> in your own {METHOD_NAMES[confirming.provider] ?? confirming.provider}{" "}
              account. A screenshot or the customer saying so is not proof.
            </p>
            {confirming.gateway_check ? (
              <p className={confirming.gateway_check.result === "MATCHED" ? legacy.noticeSuccess : legacy.noticeWarning}>{confirming.gateway_check.message}</p>
            ) : confirming.provider === "BKASH" ? (
              <p className={legacy.noticeWarning}>This ID hasn’t been checked with bKash yet. “Check with bKash” looks it up in your merchant account.</p>
            ) : null}
            <div className={legacy.rowEnd}>
              <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy !== null}>
                Not yet
              </Button>
              <Button isLoading={busy === confirming.id} disabled={busy !== null} onClick={() => void verify(confirming)}>
                Yes, I checked my account
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
