/**
 * Browser side of workspace step-up (FX-97 Part A). A privileged request that answers 403 STEP_UP_REQUIRED (or
 * MFA_ENROLLMENT_REQUIRED) names the action in `error.details.action`; `fetchWithStepUp` asks the mounted
 * <StepUpHost> for a fresh authenticator code, gets a token for exactly that action and sends the request once more
 * with `x-step-up-token`. Without a mounted host, or when the person cancels, the original response is returned.
 */

export type StepUpReason = "STEP_UP_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";

export interface StepUpRequest {
  action: string;
  reason: StepUpReason;
  message: string;
}

/** Resolves with a step-up token for `request.action`, or null if the person cancelled. */
export type StepUpPrompt = (request: StepUpRequest) => Promise<string | null>;

let activePrompt: StepUpPrompt | null = null;

/** Called by <StepUpHost>; pass null on unmount. */
export function registerStepUpPrompt(prompt: StepUpPrompt | null): void {
  activePrompt = prompt;
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { action?: unknown } };
}

export async function fetchWithStepUp(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 403 || !activePrompt) return response;
  // A token only ever goes back to this app's own origin
  if (typeof window !== "undefined" && new URL(input, window.location.origin).origin !== window.location.origin) return response;

  let body: ErrorBody;
  try {
    body = (await response.clone().json()) as ErrorBody;
  } catch {
    return response;
  }
  const code = body.error?.code;
  const action = body.error?.details?.action;
  if ((code !== "STEP_UP_REQUIRED" && code !== "MFA_ENROLLMENT_REQUIRED") || typeof action !== "string") return response;

  const token = await activePrompt({ action, reason: code, message: body.error?.message ?? "" });
  if (!token) return response;

  const headers = new Headers(init.headers);
  headers.set("x-step-up-token", token);
  return fetch(input, { ...init, headers });
}

/** What each action does, in the words shown in the dialog ("Confirm to …"). */
export const STEP_UP_ACTION_LABELS: Record<string, string> = {
  APPROVE_BROADCAST: "approve this broadcast",
  RESUME_BROADCASTS: "turn broadcasts back on",
  APPROVE_CAMPAIGN: "approve this campaign",
  APPROVE_DECISION: "approve this decision",
  APPROVE_PRICE_CHANGE: "approve this price change",
  APPROVE_PURCHASE_ORDER: "approve this purchase order",
  APPROVE_AI_ACTION: "approve this AI action",
  CLEAR_AUTONOMY_KILL_SWITCH: "turn automatic operations back on",
  RUN_REPLENISHMENT: "run replenishment (it can send a purchase order)",
  CUSTOMER_ERASE: "erase this customer's data",
  RESET_MEMBER_MFA: "reset this member's authenticator",
  CHANGE_PAYMENT_SETTINGS: "change how this shop gets paid",
};
