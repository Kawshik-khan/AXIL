import { ConversationStatus } from "@/types/social";
import { BadRequestError } from "@/lib/errors";

export class ConversationStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
    OPEN: ["WAITING_CUSTOMER", "WAITING_AGENT", "RESOLVED", "CLOSED", "SPAM"],
    PENDING: ["OPEN", "WAITING_AGENT", "WAITING_CUSTOMER", "RESOLVED", "CLOSED", "SPAM"],
    WAITING_CUSTOMER: ["WAITING_AGENT", "OPEN", "RESOLVED", "CLOSED", "SPAM"],
    WAITING_AGENT: ["WAITING_CUSTOMER", "OPEN", "RESOLVED", "CLOSED", "SPAM"],
    RESOLVED: ["OPEN", "CLOSED"], // Reopened if customer messages back
    CLOSED: ["OPEN"],             // Reopened on customer message
    SPAM: ["OPEN"],
  };

  public static canTransition(from: ConversationStatus, to: ConversationStatus): boolean {
    if (from === to) return true;
    const allowed = this.ALLOWED_TRANSITIONS[from];
    return !!allowed && allowed.includes(to);
  }

  public static assertValidTransition(from: ConversationStatus, to: ConversationStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestError(
        `Invalid conversation status transition from '${from}' to '${to}'. Allowed targets: ${
          this.ALLOWED_TRANSITIONS[from]?.join(", ") || "none"
        }`
      );
    }
  }
}
