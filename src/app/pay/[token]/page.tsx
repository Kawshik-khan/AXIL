"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, ChevronRight, Clock, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button/Button";
import { Input } from "@/components/ui/Input/Input";
import { LoadingSkeleton } from "@/components/ui/States/States";
import { api, formatBdt, formatDateTime, GATEWAY_HINTS, GATEWAY_NAMES, type ApiFailure } from "@/components/payments/api";
import styles from "@/components/payments/Payments.module.css";

type ManualMethod = "BKASH" | "NAGAD" | "ROCKET";

interface PublicLink {
  shop_name: string;
  order_number: string;
  amount: number;
  currency: "BDT";
  note: string | null;
  status: "ACTIVE" | "PAID" | "CANCELLED" | "EXPIRED";
  expires_at: string;
  awaiting_verification: boolean;
  can_submit_transaction_id: boolean;
  methods: {
    manual: {
      bkash_number?: string;
      bkash_account_type?: "PERSONAL" | "MERCHANT";
      nagad_number?: string;
      nagad_account_type?: "PERSONAL" | "MERCHANT";
      rocket_number?: string;
      instructions?: string;
    };
    gateways: string[];
  };
}

/** What the gateway round trip reported in the URL. Only a hint for wording: "paid" is shown from the link's own status. */
const RETURN_NOTES: Record<string, { tone: "warning" | "danger"; text: string }> = {
  cancelled: { tone: "warning", text: "The payment was cancelled. Nothing was charged. You can try again below." },
  failed: { tone: "danger", text: "The payment did not go through. Nothing was recorded. You can try again below." },
  pending: { tone: "warning", text: "We could not confirm the payment yet. If money left your account, the shop will confirm it shortly. Do not pay twice." },
  test: { tone: "warning", text: "Test payment confirmed by the gateway's sandbox. No real money moved and the order was not marked paid." },
};

/**
 * The page behind a shop's payment link (ADR-123). Public: the token in the address is the only credential. It shows
 * the shop, the order number and the amount, and lets the customer pay online through the shop's gateway or send
 * money by hand and submit the transaction id for the shop to check.
 */
export default function PayPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [link, setLink] = useState<PublicLink | null>(null);
  const [loadError, setLoadError] = useState<ApiFailure | null>(null);
  const [returnNote, setReturnNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [method, setMethod] = useState<ManualMethod | "">("");
  const [transactionId, setTransactionId] = useState("");
  const [senderLast4, setSenderLast4] = useState("");
  const [submitted, setSubmitted] = useState(false);
  /** After a submission the form is hidden; the customer opens it again only to correct a wrong id. */
  const [correcting, setCorrecting] = useState(false);

  const load = useCallback(async () => {
    const result = await api<{ link: PublicLink }>(`/api/v1/pay/${encodeURIComponent(token)}`);
    if (result.ok && result.data) {
      setLink(result.data.link);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [token]);

  useEffect(() => {
    setReturnNote(new URLSearchParams(window.location.search).get("payment"));
    void load();
  }, [load]);

  const manual = link?.methods.manual ?? {};
  const wallets: Array<{ method: ManualMethod; label: string; number: string; how: string }> = [];
  if (manual.bkash_number) {
    wallets.push({ method: "BKASH", label: "bKash", number: manual.bkash_number, how: manual.bkash_account_type === "MERCHANT" ? "Payment" : "Send Money" });
  }
  if (manual.nagad_number) {
    wallets.push({ method: "NAGAD", label: "Nagad", number: manual.nagad_number, how: manual.nagad_account_type === "MERCHANT" ? "Payment" : "Send Money" });
  }
  if (manual.rocket_number) wallets.push({ method: "ROCKET", label: "Rocket", number: manual.rocket_number, how: "Send Money" });
  const chosen = method || wallets[0]?.method || "";

  const payOnline = async (provider: string) => {
    setActionError(null);
    setBusy(provider);
    const result = await api<{ redirect_url: string }>(`/api/v1/pay/${encodeURIComponent(token)}/checkout`, { method: "POST", json: { provider } });
    if (result.ok && result.data?.redirect_url) {
      window.location.href = result.data.redirect_url; // the gateway's own page; busy stays on while the browser leaves
      return;
    }
    setBusy(null);
    setActionError(result.error?.message ?? "Could not start the payment.");
    void load();
  };

  const submitManual = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    setActionError(null);
    setBusy("manual");
    const result = await api<{ status: string }>(`/api/v1/pay/${encodeURIComponent(token)}/manual`, {
      method: "POST",
      json: {
        method: chosen,
        transaction_id: transactionId.trim(),
        ...(chosen === "BKASH" && senderLast4.trim() ? { sender_last4: senderLast4.trim() } : {}),
      },
    });
    setBusy(null);
    if (result.ok) {
      setSubmitted(true);
      setCorrecting(false);
      setTransactionId("");
      setSenderLast4("");
    } else {
      setActionError(result.error?.message ?? "Could not submit the transaction ID.");
    }
    void load();
  };

  if (!link && !loadError) {
    return (
      <main className={styles.publicShell}>
        <div className={styles.publicCard}>
          <LoadingSkeleton lines={4} inline />
        </div>
      </main>
    );
  }

  if (!link) {
    const notFound = loadError?.code === "NOT_FOUND" || loadError?.code === "RESOURCE_NOT_FOUND";
    return (
      <main className={styles.publicShell}>
        <div className={styles.publicCard} role="alert">
          <XCircle size={32} color="var(--color-danger)" aria-hidden />
          <h1 className={styles.sectionTitle}>{notFound ? "This payment link is not valid" : "This page could not be loaded"}</h1>
          <p className={styles.publicMeta}>
            {notFound ? "Check the link the shop sent you, or ask them for a new one." : loadError?.message}
          </p>
          {!notFound && (
            <>
              {loadError?.request_id && <p className={styles.muted}>Reference: {loadError.request_id}</p>}
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            </>
          )}
        </div>
      </main>
    );
  }

  const note = returnNote && link.status === "ACTIVE" ? RETURN_NOTES[returnNote] : undefined;
  const waiting = link.awaiting_verification || submitted;
  // The form shows for a first submission, or when the customer says the id they sent was wrong; never once the link is full
  const showForm = link.can_submit_transaction_id && (!waiting || correcting);
  const nothingConfigured = link.methods.gateways.length === 0 && wallets.length === 0;

  return (
    <main className={styles.publicShell}>
      <div className={styles.publicCard}>
        <div>
          <p className={styles.publicShop}>{link.shop_name}</p>
          <p className={styles.publicAmount}>{formatBdt(link.amount)}</p>
          <p className={styles.publicMeta}>
            Order {link.order_number}
            {link.note ? ` · ${link.note}` : ""}
          </p>
        </div>

        {link.status === "PAID" && (
          <div className={styles.noticeSuccess} role="status">
            <div className={styles.row}>
              <CheckCircle2 size={20} aria-hidden />
              <strong>Payment received</strong>
            </div>
            {link.shop_name} has your payment of {formatBdt(link.amount)} for order {link.order_number}. You can close this page.
          </div>
        )}
        {link.status === "CANCELLED" && (
          <div className={styles.noticeWarning} role="status">
            The shop cancelled this payment link. Contact {link.shop_name} if you still need to pay.
          </div>
        )}
        {link.status === "EXPIRED" && (
          <div className={styles.noticeWarning} role="status">
            This payment link expired on {formatDateTime(link.expires_at)}. Ask {link.shop_name} for a new one.
          </div>
        )}

        {link.status === "ACTIVE" && (
          <>
            {note && (
              <div className={note.tone === "danger" ? styles.noticeDanger : styles.noticeWarning} role="status">
                {note.text}
              </div>
            )}
            {(link.awaiting_verification || submitted) && (
              <div className={styles.notice} role="status">
                <div className={styles.row}>
                  <Clock size={18} aria-hidden />
                  <strong>The shop is checking your payment</strong>
                </div>
                Your transaction ID was sent to {link.shop_name}. This page will show "Payment received" once they confirm it.
              </div>
            )}
            {actionError && (
              <div className={styles.noticeDanger} role="alert">
                {actionError}
              </div>
            )}

            {nothingConfigured && (
              <div className={styles.noticeWarning} role="status">
                {link.shop_name} has not set up a way to pay from this page yet. Contact the shop to arrange payment.
              </div>
            )}

            {link.methods.gateways.length > 0 && (
              <section className={styles.stack} aria-label="Pay online">
                <h2 className={styles.sectionTitle}>Pay online</h2>
                {link.methods.gateways.map((provider) => (
                  <button key={provider} type="button" className={styles.methodButton} disabled={busy !== null} onClick={() => void payOnline(provider)}>
                    <span>
                      {busy === provider ? "Opening" : "Pay with"} {GATEWAY_NAMES[provider] ?? provider}
                      <br />
                      <span className={styles.methodHint}>{GATEWAY_HINTS[provider] ?? ""}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden />
                  </button>
                ))}
              </section>
            )}

            {wallets.length > 0 && (
              <section className={styles.stack} aria-label="Send money and submit the transaction ID">
                <hr className={styles.divider} />
                <h2 className={styles.sectionTitle}>Or send {formatBdt(link.amount)} yourself</h2>
                <div>
                  {wallets.map((wallet) => (
                    <div key={wallet.method} className={styles.walletRow}>
                      <span>
                        {wallet.label} <span className={styles.methodHint}>({wallet.how})</span>
                      </span>
                      <span className={styles.walletNumber}>{wallet.number}</span>
                    </div>
                  ))}
                </div>
                {manual.instructions && <p className={styles.publicMeta}>{manual.instructions}</p>}
                {waiting && !correcting && link.can_submit_transaction_id && (
                  <Button variant="ghost" fullWidth onClick={() => setCorrecting(true)}>
                    Entered a wrong transaction ID? Send the right one
                  </Button>
                )}
                {!link.can_submit_transaction_id && !waiting && (
                  <div className={styles.noticeWarning} role="status">
                    This link can't take more transaction IDs. Contact {link.shop_name}, or ask them for a new link.
                  </div>
                )}
                {showForm && (
                <form className={styles.stack} onSubmit={submitManual}>
                  <div>
                    <label className={styles.fieldLabel} htmlFor="pay-method">
                      Paid with
                    </label>
                    <select id="pay-method" className={styles.select} value={chosen} onChange={(e) => setMethod(e.target.value as ManualMethod)}>
                      {wallets.map((wallet) => (
                        <option key={wallet.method} value={wallet.method}>
                          {wallet.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="Transaction ID (TrxID)"
                    placeholder="e.g. BK9X7Y5Z3A"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    autoComplete="off"
                    minLength={6}
                    maxLength={32}
                    required
                    hint="From the confirmation message you got after sending the money."
                  />
                  {chosen === "BKASH" && (
                    <Input
                      label="Last 4 digits of the bKash number you paid from (optional)"
                      placeholder="e.g. 4821"
                      inputMode="numeric"
                      value={senderLast4}
                      onChange={(e) => setSenderLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      autoComplete="off"
                      pattern="\d{4}"
                      hint="Helps the shop match your payment faster."
                    />
                  )}
                  <Button type="submit" variant="primary" fullWidth isLoading={busy === "manual"} disabled={busy !== null}>
                    Submit transaction ID
                  </Button>
                </form>
                )}
              </section>
            )}

            <p className={styles.muted}>This link can be used until {formatDateTime(link.expires_at)}.</p>
          </>
        )}

        <p className={styles.publicFooter}>
          <ShieldCheck size={13} aria-hidden /> Payments go directly to {link.shop_name}. Never share your PIN or OTP with anyone.
        </p>
      </div>
    </main>
  );
}
