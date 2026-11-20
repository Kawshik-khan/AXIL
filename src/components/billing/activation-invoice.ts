/**
 * Which invoice the activation page (/activate) should offer for payment.
 *
 * An ISSUED invoice is payable only until its due date (BillingService.payableInvoice refuses it after that). A
 * past-due one must not be shown as the open invoice: that would hide the plan picker, and the only way to get a
 * payable invoice is to choose the plan again (createInvoice voids the old ISSUED one).
 */
export interface ActivationInvoiceLike {
  status: string;
  due_date: string;
}

export function activationInvoices<T extends ActivationInvoiceLike>(
  invoices: readonly T[],
  now: number = Date.now()
): { open: T | undefined; expired: T | undefined } {
  const pending = invoices.find((i) => i.status === "PENDING_VERIFICATION");
  if (pending) return { open: pending, expired: undefined };
  const issued = invoices.filter((i) => i.status === "ISSUED");
  const open = issued.find((i) => !(Date.parse(i.due_date) < now));
  return { open, expired: open ? undefined : issued[0] };
}
