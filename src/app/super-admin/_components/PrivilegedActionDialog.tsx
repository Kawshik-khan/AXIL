"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Button } from "@/components/ui/Button/Button";
import { findPrivilegedAction } from "@/domains/platform/privileged-actions";
import type { ImpactPreview } from "@/domains/platform/services/platform-impact.service";
import type { ApprovalView } from "@/domains/platform/services/platform-approval.service";
import { PlatformApiError, platformRequest } from "../_lib/platform-client";
import { usePlatformSession } from "../_lib/platform-session";
import { formatCountdown, formatCount, formatDateTime } from "../_lib/format";
import { StatusPill } from "./StatusPill";
import { StepUpPrompt } from "./StepUpPrompt";
import styles from "../super-admin.module.css";

export type ApprovalTargetType = "tenant" | "kill_switch" | "operator" | "plan_version" | "entitlement" | "platform";

export interface ExecuteArgs {
  reason: string;
  ticketRef?: string;
  confirmation?: string;
  approvalId?: string;
  stepUpToken: string | null;
}

export interface PrivilegedActionDialogProps {
  open: boolean;
  onClose: () => void;
  actionKey: string;
  target: { type: ApprovalTargetType; id: string; label: string; slug?: string };
  /** What the impact preview should count (GET /api/v1/platform/impact). */
  impact?: { scope?: string; target?: string } | null;
  /** Extra inputs for the action (values, dates); rendered above the reason. */
  children?: React.ReactNode;
  /** False while the extra inputs are incomplete. */
  canSubmit?: boolean;
  submitLabel?: string;
  execute: (args: ExecuteArgs) => Promise<unknown>;
  onDone: (result: unknown) => void;
}

type Phase = "form" | "step-up" | "needs-approval" | "requested";

/**
 * One confirmation flow for every privileged action (plan §5.4): impact preview → reason/ticket → typed
 * confirmation → step-up → execute, or request a second operator's approval when the server says so. The server
 * decides what is allowed; this dialog only asks for what the action's declaration requires.
 */
export const PrivilegedActionDialog: React.FC<PrivilegedActionDialogProps> = ({
  open,
  onClose,
  actionKey,
  target,
  impact,
  children,
  canSubmit = true,
  submitLabel,
  execute,
  onDone,
}) => {
  const spec = useMemo(() => findPrivilegedAction(actionKey), [actionKey]);
  const { session, stepUp, clearStepUp } = usePlatformSession();
  const [phase, setPhase] = useState<Phase>("form");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [approvalPayload, setApprovalPayload] = useState<Record<string, unknown> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Pages pass the impact query inline: key the effect on its value, not its identity
  const impactKey = impact ? JSON.stringify({ scope: impact.scope ?? null, target: impact.target ?? null }) : null;

  const loadApprovals = useCallback(async () => {
    if (!spec || spec.approval === "never") return;
    try {
      const res = await platformRequest<ApprovalView[]>("/api/v1/platform/approvals?limit=200");
      setApprovals(
        res.data.filter(
          (a) =>
            a.action_key === spec.key &&
            a.target_id === target.id &&
            a.requested_by === session.user.id &&
            (a.effective_status === "PENDING" || a.effective_status === "APPROVED")
        )
      );
    } catch {
      setApprovals([]);
    }
  }, [spec, target.id, session.user.id]);

  useEffect(() => {
    if (!open) return;
    setPhase("form");
    setReason("");
    setTicket("");
    setConfirmation("");
    setError(null);
    setPreview(null);
    setPreviewError(null);
    setApprovalPayload(null);
    void loadApprovals();
    if (impactKey) {
      const { scope, target: impactTarget } = JSON.parse(impactKey) as { scope: string | null; target: string | null };
      const q = new URLSearchParams({ action: actionKey });
      if (scope) q.set("scope", scope);
      if (impactTarget) q.set("target", impactTarget);
      platformRequest<ImpactPreview>(`/api/v1/platform/impact?${q.toString()}`)
        .then((res) => setPreview(res.data))
        .catch((err: unknown) => setPreviewError(err instanceof PlatformApiError ? err.message : "Impact could not be computed."));
    }
  }, [open, actionKey, impactKey, loadApprovals]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!spec) {
    return (
      <Modal isOpen={open} onClose={onClose} title="Unknown action">
        <p className={styles.fieldError}>&quot;{actionKey}&quot; is not a declared privileged action.</p>
      </Modal>
    );
  }

  const approved = approvals.find((a) => a.effective_status === "APPROVED");
  const pending = approvals.find((a) => a.effective_status === "PENDING");
  const phrase = spec.confirmPhrase?.({ id: target.id, slug: target.slug });
  const reasonOk = spec.reasonMin === 0 || reason.trim().length >= spec.reasonMin;
  const ticketOk = !spec.ticketRequired || ticket.trim().length > 0;
  const confirmOk = !phrase || confirmation === phrase;
  const ready = canSubmit && reasonOk && ticketOk && confirmOk;
  const dangerous = spec.risk === "HIGH" || spec.risk === "CRITICAL";

  const run = async (tokenOverride?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await execute({
        reason: reason.trim(),
        ticketRef: ticket.trim() || undefined,
        confirmation: phrase ? confirmation : undefined,
        approvalId: approved?.id,
        stepUpToken: tokenOverride ?? stepUp?.token ?? null,
      });
      if (spec.risk === "CRITICAL") clearStepUp(); // a CRITICAL action uses up its step-up (rules §3.2)
      onDone(result);
      onClose();
    } catch (err) {
      if (err instanceof PlatformApiError && err.code === "STEP_UP_REQUIRED") {
        setPhase("step-up");
      } else if (err instanceof PlatformApiError && err.code === "APPROVAL_REQUIRED") {
        const payload = err.details?.payload;
        setApprovalPayload(payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null);
        setPhase("needs-approval");
      } else if (err instanceof PlatformApiError) {
        setError(`${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}`);
      } else {
        setError("The platform API could not be reached.");
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (spec.stepUp && !stepUp) {
      setPhase("step-up");
      return;
    }
    void run();
  };

  const requestApproval = async () => {
    if (!approvalPayload) {
      setError("The server did not return the input to approve; try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await platformRequest("/api/v1/platform/approvals", {
        method: "POST",
        json: {
          action_key: spec.key,
          payload: approvalPayload,
          reason: reason.trim(),
          ...(ticket.trim() ? { ticket_ref: ticket.trim() } : {}),
        },
      });
      await loadApprovals();
      setPhase("requested");
    } catch (err) {
      setError(err instanceof PlatformApiError ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}` : "The request failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (id: string) => {
    setBusy(true);
    try {
      await platformRequest(`/api/v1/platform/approvals/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      await loadApprovals();
    } catch (err) {
      setError(err instanceof PlatformApiError ? err.message : "Could not cancel the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={spec.label}>
      <div className={styles.inlineActions}>
        <StatusPill status={spec.risk} tone={spec.risk === "CRITICAL" || spec.risk === "HIGH" ? "bad" : spec.risk === "MEDIUM" ? "warn" : "neutral"} label={`${spec.risk} risk`} />
        <span className={styles.hint}>Target: {target.label}</span>
      </div>

      {impact && (
        <div className={dangerous ? styles.dangerZone : styles.sectionGap}>
          {preview ? (
            <>
              <strong>{preview.summary}</strong>
              <ul className={styles.list}>
                {preview.lines.map((line) => (
                  <li key={line.label} className={styles.listRow}>
                    <span>{line.label}</span>
                    <span className={styles.mono}>{line.value === null ? line.note ?? "Not countable" : formatCount(line.value)}</span>
                  </li>
                ))}
              </ul>
              <span className={styles.hint}>Counted {formatDateTime(preview.computed_at)} (Dhaka)</span>
            </>
          ) : previewError ? (
            <span className={styles.fieldError}>{previewError}</span>
          ) : (
            <span className={styles.hint}>Counting what this affects…</span>
          )}
        </div>
      )}

      {approved && (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span>
            Approved by a second operator · expires in {formatCountdown(approved.expires_at, now)}. Run it with the same
            inputs you requested.
          </span>
        </div>
      )}
      {!approved && pending && (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <span>
            Waiting for a second operator to approve (requested {formatDateTime(pending.requested_at)}, expires in{" "}
            {formatCountdown(pending.expires_at, now)}).
          </span>
          <Button size="sm" variant="ghost" onClick={() => cancelRequest(pending.id)} disabled={busy}>
            Withdraw
          </Button>
        </div>
      )}

      {phase === "step-up" ? (
        <StepUpPrompt
          onGranted={(token) => {
            setPhase("form");
            void run(token);
          }}
          onCancel={() => setPhase("form")}
        />
      ) : phase === "needs-approval" ? (
        <div className={styles.sectionGap}>
          <p className={styles.hint}>
            This action needs a second operator with approval rights. Request it with the reason and ticket below; when it
            is approved, open this action again and run it.
          </p>
          <div className={styles.inlineActions}>
            <Button size="sm" onClick={requestApproval} isLoading={busy}>
              Request approval
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPhase("form")}>
              Back
            </Button>
          </div>
        </div>
      ) : phase === "requested" ? (
        <p className={styles.hint}>Approval requested. Operators who can approve see it in Security → Approvals.</p>
      ) : (
        <>
          {children}
          {spec.reasonMin > 0 && (
            <label className={styles.field}>
              Reason
              <span className={styles.hint}>At least {spec.reasonMin} characters; kept in the audit log.</span>
              <textarea className={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </label>
          )}
          {spec.ticketRequired && (
            <label className={styles.field}>
              Ticket or incident reference
              <input className={styles.input} value={ticket} onChange={(e) => setTicket(e.target.value)} maxLength={100} />
            </label>
          )}
          {phrase && (
            <label className={styles.field}>
              Type <code className={styles.mono}>{phrase}</code> to confirm
              <input className={styles.input} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
            </label>
          )}
          <div className={styles.inlineActions}>
            <Button variant={dangerous ? "danger" : "primary"} onClick={submit} isLoading={busy} disabled={!ready}>
              {submitLabel ?? spec.label}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <span className={styles.hint}>Recovery: {spec.rollback}</span>
        </>
      )}

      {error && (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </Modal>
  );
};
