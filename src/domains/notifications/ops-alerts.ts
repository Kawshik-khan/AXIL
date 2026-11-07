/**
 * Platform alerts for the people running CommerceOS (production readiness O6): the monitoring job's findings go to one
 * Telegram chat (OPS_ALERTS_CHAT_ID) through the platform alerts bot (TELEGRAM_ALERTS_BOT_TOKEN). No new dependency
 * and no customer data: issue titles and counts only.
 *
 * A chat isn't flooded: an alert is sent when the set of issues changes, repeated at most once an hour while the same
 * issues last, and followed by one "resolved" message when they clear.
 */
import { alertsBotCall, alertsBotConfigured } from "@/domains/notifications/alerts-bot";
import { logger } from "@/lib/logger";

export interface OpsIssue {
  /** Stable key, so the same problem isn't announced as new on every run. */
  key: string;
  title: string;
  severity: "warning" | "critical";
  detail?: string;
}

export type OpsAlertStatus = "SENT" | "RESOLVED_SENT" | "SUPPRESSED" | "HEALTHY" | "NOT_CONFIGURED" | "FAILED";

const REPEAT_MS = 60 * 60 * 1000;

let last: { signature: string; sentAt: number } | null = null;

export function opsAlertsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return alertsBotConfigured(env) && /^-?\d{1,20}$/.test((env.OPS_ALERTS_CHAT_ID ?? "").trim());
}

function format(issues: OpsIssue[], appUrl: string | undefined): string {
  const lines = issues.map((i) => `${i.severity === "critical" ? "🔴" : "🟠"} ${i.title}${i.detail ? `: ${i.detail}` : ""}`);
  return [`CommerceOS needs attention${appUrl ? ` (${appUrl})` : ""}`, ...lines].join("\n");
}

/** Sends (or holds back) the alert for this monitoring run's issues. Never throws. */
export async function reportOpsIssues(issues: OpsIssue[], now = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<OpsAlertStatus> {
  const signature = issues.map((i) => i.key).sort().join("|");
  if (!opsAlertsConfigured(env)) {
    if (issues.length) logger.warn("ops_alert.not_configured", { issues: issues.map((i) => i.key) });
    return issues.length ? "NOT_CONFIGURED" : "HEALTHY";
  }

  let text: string | null = null;
  let status: OpsAlertStatus;
  if (!issues.length) {
    if (!last) return "HEALTHY";
    text = "✅ CommerceOS: all clear again.";
    status = "RESOLVED_SENT";
  } else if (last && last.signature === signature && now - last.sentAt < REPEAT_MS) {
    return "SUPPRESSED";
  } else {
    text = format(issues, env.APP_URL);
    status = "SENT";
  }

  try {
    await alertsBotCall("sendMessage", { chat_id: (env.OPS_ALERTS_CHAT_ID ?? "").trim(), text, disable_web_page_preview: true });
    last = issues.length ? { signature, sentAt: now } : null;
    logger.info("ops_alert.sent", { status, issues: issues.map((i) => i.key) });
    return status;
  } catch (err) {
    logger.error("ops_alert.failed", { error: err instanceof Error ? err.message : String(err) });
    return "FAILED";
  }
}

export function resetOpsAlertsForTesting(): void {
  last = null;
}
