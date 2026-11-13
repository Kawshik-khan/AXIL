/**
 * bKash transaction lookup for send-money payments (ADR-124).
 *
 * A customer who paid the shop's bKash number submits the TrxID on a payment link; that is a PENDING payment (ADR-123).
 * When the shop has saved its bKash merchant (PGW) credentials, the TrxID is looked up with bKash's Search Transaction
 * API. bKash answers with the merchant's own transactions only.
 *
 * The answer is stored on the payment for staff to see. It confirms the payment on its own only when the platform turns
 * that on (BKASH_TRX_AUTO_CONFIRM=1), the money is real (LIVE, or sandbox with PAYMENTS_SANDBOX_SETTLES=1, marked TEST),
 * and the answer is a full match: completed, same amount, after the link was made, a plain incoming payment, and paid
 * from a number ending in the digits the customer gave. Everything else waits for a person.
 *
 * bKash is called with no store lock held (ADR-110, security review H1); the result is written in its own short unit of
 * work that re-reads the payment first.
 */
import { db } from "@/infrastructure/db";
import { loadOrderRows } from "@/infrastructure/db/tenant-rows";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { Payment, PaymentGatewayCheck, PaymentGatewayCheckResult } from "@/types/commerce";
import { sandboxSettles, storeGatewayAccount } from "./gateways/gateway-accounts";
import { searchBkashTransaction, type BkashTransactionLookup } from "./gateways/bkash.adapter";
import { sameAmount, type GatewayAccount } from "./gateways/gateway.types";
import { linkIdFromPayment, UNPAYABLE_ORDER_STATUSES } from "./payment-link.service";
import { PaymentService } from "./payment.service";

/** Clocks differ: a transaction this long before the link was made still counts as after it. */
const CLOCK_SKEW_MS = 2 * 60_000;

/** The platform switch for confirming without a person (off unless set). */
export function trxAutoConfirmEnabled(mode: GatewayAccount["mode"], env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BKASH_TRX_AUTO_CONFIRM !== "1") return false;
  return mode === "LIVE" || sandboxSettles("STORE", env);
}

/**
 * A customer paying a merchant number from the bKash app. Checkout payments (they settle through their own callback),
 * refunds, payouts and transfers never confirm a submitted TrxID automatically. bKash's type names are not verified
 * against the live API: anything unrecognised is left to a person.
 */
export function isIncomingPaymentType(type: string | undefined): boolean {
  if (!type) return false;
  if (/refund|revers|disburs|payout|cash\s*out|b2c|transfer|checkout|agreement/i.test(type)) return false;
  return /payment/i.test(type);
}

function bdt(amount: number): string {
  return `৳${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Compares bKash's answer with the pending payment. Pure, so the rules are tested on their own. */
export function evaluateLookup(
  lookup: BkashTransactionLookup,
  payment: Pick<Payment, "transaction_id" | "amount" | "payer_last4">,
  linkCreatedAt: string | undefined
): { result: PaymentGatewayCheckResult; message: string; autoConfirmable: boolean } {
  const trx = (payment.transaction_id ?? "").trim().toUpperCase();
  if (!lookup.found || (lookup.trxId ?? "").trim().toUpperCase() !== trx) {
    return { result: "NOT_FOUND", message: "bKash has no transaction with this ID in your account.", autoConfirmable: false };
  }
  if (lookup.status !== "Completed") {
    return { result: "NOT_COMPLETED", message: `bKash says this transaction is ${lookup.status ?? "not completed"}.`, autoConfirmable: false };
  }
  if ((lookup.currency && lookup.currency.toUpperCase() !== "BDT") || lookup.amount === undefined || !sameAmount(lookup.amount, payment.amount)) {
    const foreign = lookup.currency && lookup.currency.toUpperCase() !== "BDT" ? `${lookup.currency} ` : "";
    const got = lookup.amount === undefined ? "an amount it did not state" : `${foreign}${bdt(lookup.amount)}`;
    return { result: "AMOUNT_MISMATCH", message: `bKash shows ${got}, not ${bdt(payment.amount)}.`, autoConfirmable: false };
  }
  const linkTime = linkCreatedAt ? Date.parse(linkCreatedAt) : NaN;
  const completedTime = lookup.completedAt ? Date.parse(lookup.completedAt) : NaN;
  if (Number.isFinite(linkTime) && Number.isFinite(completedTime) && completedTime < linkTime - CLOCK_SKEW_MS) {
    return { result: "BEFORE_LINK", message: "bKash shows this money arrived before the payment link was made. Check it isn't for another order.", autoConfirmable: false };
  }
  if (payment.payer_last4 && lookup.payerLast4 && payment.payer_last4 !== lookup.payerLast4) {
    return {
      result: "SENDER_MISMATCH",
      message: `bKash shows this money came from a number not ending in ${payment.payer_last4}, the digits the customer gave. It may be someone else's payment.`,
      autoConfirmable: false,
    };
  }

  // A match. What still needs a person, if anything:
  const why: string[] = [];
  if (!Number.isFinite(completedTime) || !Number.isFinite(linkTime)) why.push("bKash gave no time we could read; check the date");
  if (!payment.payer_last4) why.push("the customer did not give the sending number's last 4 digits");
  else if (!lookup.payerLast4) why.push("bKash did not say which number paid");
  if (!isIncomingPaymentType(lookup.transactionType)) why.push(`bKash lists it as "${lookup.transactionType ?? "an unnamed type"}", not a plain payment to you`);
  return {
    result: "MATCHED",
    message: `bKash confirms ${bdt(lookup.amount)} received.${why.length ? ` Confirm it yourself: ${why.join("; ")}.` : ""}`,
    autoConfirmable: why.length === 0,
  };
}

/** Errors a confirmation raises before it writes anything: the payment just stays for a person. */
function isRefusal(err: unknown): boolean {
  return err instanceof ValidationError || err instanceof ConflictError || err instanceof NotFoundError;
}

export class TrxLookupService {
  /**
   * Looks up a PENDING bKash payment's TrxID and stores the answer on it. Returns null when there is nothing to look up
   * (not bKash, not pending, no transaction id, or the shop has no bKash merchant credentials). bKash being
   * unreachable is stored as UNAVAILABLE. Must be called outside a unit of work: it opens its own after bKash answers.
   * `auditActor`: a staff member who asked, recorded in the same unit as the result.
   */
  public static async check(
    tenantId: string,
    paymentId: string,
    options: { auditActor?: string } = {}
  ): Promise<{ payment: Payment; autoConfirmed: boolean } | null> {
    const before = db.findPaymentById(tenantId, paymentId);
    if (!before || before.provider !== "BKASH" || before.status !== "PENDING" || !before.transaction_id) return null;
    const trx = before.transaction_id;

    let account: GatewayAccount;
    try {
      // The credentials, even when checkout itself is not offered on links
      account = storeGatewayAccount(tenantId, "BKASH", { evenIfDisabled: true });
    } catch {
      return null;
    }

    // No store lock held here: bKash may take its full timeout
    let lookup: BkashTransactionLookup | null = null;
    try {
      lookup = await searchBkashTransaction(account, trx);
    } catch (err) {
      logger.warn("payments.bkash.lookup_failed", { tenant_id: tenantId, payment_id: paymentId, error: err instanceof Error ? err.message : String(err) });
    }

    return db.unit(async () => {
      const decided = await (async (): Promise<{ payment: Payment; autoConfirmed: boolean; result: string }> => {
      // Re-read: staff may have confirmed or rejected it while bKash was answering
      const payment = db.findPaymentById(tenantId, paymentId);
      if (!payment || payment.status !== "PENDING" || payment.transaction_id !== trx) {
        return { payment: payment ?? before, autoConfirmed: false, result: "CHANGED_WHILE_CHECKING" };
      }
      const linkId = linkIdFromPayment(payment);
      const link = linkId ? db.findPaymentLinkById(tenantId, linkId) : undefined;
      await loadOrderRows(tenantId, [payment.order_id]);
      const now = new Date().toISOString();

      let check: PaymentGatewayCheck;
      if (!lookup) {
        check = {
          provider: "BKASH",
          result: "UNAVAILABLE",
          mode: account.mode,
          checked_at: now,
          message: "Could not reach bKash to check this ID. Try again, or check it in your bKash account.",
          auto_confirmable: false,
        };
      } else {
        const outcome = evaluateLookup(lookup, payment, link?.created_at);
        check = {
          provider: "BKASH",
          result: outcome.result,
          mode: account.mode,
          checked_at: now,
          message: account.mode === "SANDBOX" ? `Sandbox (test money): ${outcome.message}` : outcome.message,
          ...(lookup.amount !== undefined ? { amount: lookup.amount } : {}),
          ...(lookup.completedAt ? { completed_at: lookup.completedAt } : {}),
          ...(lookup.transactionType ? { transaction_type: lookup.transactionType.slice(0, 80) } : {}),
          auto_confirmable: outcome.autoConfirmable,
        };
      }
      const saved = db.setPaymentGatewayCheck(tenantId, paymentId, check) ?? payment;
      const order = db.findOrderById(tenantId, payment.order_id);
      const linkOpen = Boolean(link && link.status === "ACTIVE" && Date.parse(link.expires_at) > Date.now());
      const mayConfirm =
        check.result === "MATCHED" &&
        check.auto_confirmable &&
        trxAutoConfirmEnabled(account.mode) &&
        linkOpen &&
        Boolean(order && !UNPAYABLE_ORDER_STATUSES.has(order.status)) &&
        // A checkout attempt that carries this id settles through its own callback, never through a submitted id
        !db.findPaidGatewayAttemptByTransaction("BKASH", trx.trim().toUpperCase(), "");
      if (!mayConfirm) return { payment: saved, autoConfirmed: false, result: check.result };

      try {
        const confirmed = await PaymentService.confirmFromGatewayLookup(tenantId, paymentId, trx, account.mode === "SANDBOX");
        return { payment: confirmed, autoConfirmed: confirmed.status === "PAID", result: check.result };
      } catch (err) {
        // Refused before anything was written (e.g. more than is still due): a person sorts it out. Anything else
        // fails the unit, so a half-done confirmation is never kept.
        if (!isRefusal(err)) throw err;
        logger.warn("payments.bkash.lookup_confirm_refused", { tenant_id: tenantId, payment_id: paymentId, error: (err as AppError).message });
        return { payment: db.findPaymentById(tenantId, paymentId) ?? saved, autoConfirmed: false, result: check.result };
      }
      })();
      // A staff member asked: recorded whatever happened, in the same unit as the result
      if (options.auditActor) {
        db.createAuditLog({
          id: newId("aud"),
          tenant_id: tenantId,
          actor_user_id: options.auditActor,
          action: "PAYMENT_TRX_CHECKED",
          resource_type: "payment",
          resource_id: paymentId,
          metadata: { result: decided.result, auto_confirmed: decided.autoConfirmed },
          created_at: new Date().toISOString(),
        });
      }
      return { payment: decided.payment, autoConfirmed: decided.autoConfirmed };
    }, () => true);
  }
}
