"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft, CircleCheck, PanelRight, RotateCcw, X } from "lucide-react";
import { ConversationStateMachine } from "@/domains/social/conversations/state-machine";
import { controlOf } from "@/domains/social/conversations/conversation-control.state";
import type { ConversationStatus } from "@/types/social";
import { STATUS_LABELS, TEAM_LABELS, answeringOf, answeringText, channelName, customerName, initialsOf, type InboxTeam } from "./inbox-view";
import { Composer, type Draft } from "./Composer";
import { MessageStream } from "./MessageStream";
import type { Inbox } from "./useInbox";
import styles from "./Inbox.module.css";

/** "✦ AI agent | You": who answers the chat, and the way to change it. */
export const AnswerSwitch: React.FC<{ inbox: Inbox }> = ({ inbox }) => {
  const c = inbox.active;
  const meta = inbox.meta;
  if (!c || !meta) return null;
  const answering = answeringOf(c, meta.viewer_id);
  const isBusy = inbox.busy === "control" || inbox.busy === "assign";
  const agentOff = meta.agent_mode === "OFF";
  const withAgent = controlOf(c).state === "BOT";
  const isDone = answering === "DONE";
  return (
    <div className={styles.switch} role="group" aria-label="Who answers this chat">
      <button
        type="button"
        className={answering === "AGENT" ? styles.switchAgent : undefined}
        aria-pressed={answering === "AGENT"}
        disabled={isBusy || isDone || agentOff || withAgent}
        title={agentOff ? "The AI agent is off in this workspace." : undefined}
        onClick={() => void inbox.giveToAgent()}
      >
        ✦ AI agent
      </button>
      <button
        type="button"
        className={answering === "ME" ? styles.switchMe : answering === "NEEDS" ? styles.switchTake : undefined}
        aria-pressed={answering === "ME"}
        disabled={isBusy || isDone || answering === "ME"}
        onClick={() => void inbox.takeOver()}
      >
        {answering === "ME" ? "You" : "Take over"}
      </button>
    </div>
  );
};

/** The last action's outcome: a failure with its reason and reference, or what was done. */
export const ActionNotices: React.FC<{ inbox: Inbox }> = ({ inbox }) => (
  <>
    {inbox.actionError && (
      <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
        <span>
          {inbox.actionError.message}{" "}
          {inbox.actionError.status === 401 && (
            <a href="/login" target="_blank" rel="noreferrer">
              Sign in again
            </a>
          )}{" "}
          {inbox.actionError.request_id && <code>{inbox.actionError.request_id}</code>}
        </span>
        <button type="button" className={styles.iconButton} onClick={inbox.dismissError} aria-label="Dismiss">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    )}
    {inbox.notice && (
      <div className={styles.notice} role="status">
        <span>{inbox.notice}</span>
        <button type="button" className={styles.iconButton} onClick={() => inbox.showNotice(null)} aria-label="Dismiss">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    )}
  </>
);

/** Team and status. Only the statuses the state machine allows from the current one are offered. */
export const HandlingSelects: React.FC<{ inbox: Inbox; idPrefix: string; labels?: boolean }> = ({ inbox, idPrefix, labels = false }) => {
  const c = inbox.active;
  if (!c) return null;
  const statuses = (Object.keys(STATUS_LABELS) as ConversationStatus[]).filter((s) => s === c.status || ConversationStateMachine.canTransition(c.status, s));
  const labelClass = labels ? undefined : styles.srOnly;
  return (
    <>
      <label htmlFor={`${idPrefix}-team`}>
        <span className={labelClass}>Team</span>
        <select
          id={`${idPrefix}-team`}
          value={c.assigned_team_id ?? ""}
          disabled={inbox.busy === "assign"}
          onChange={(e) => void inbox.assign(c.assigned_user_id, (e.target.value || undefined) as InboxTeam | undefined)}
        >
          <option value="">No team</option>
          {(Object.keys(TEAM_LABELS) as InboxTeam[]).map((team) => (
            <option key={team} value={team}>
              {TEAM_LABELS[team]}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-status`}>
        <span className={labelClass}>Status</span>
        <select id={`${idPrefix}-status`} value={c.status} disabled={inbox.busy === "status"} onChange={(e) => void inbox.setStatus(e.target.value as ConversationStatus)}>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
};

/** The visible area's top and height, so an open phone keyboard shrinks the chat instead of covering its reply box. */
function useVisibleArea(active: boolean): { style: React.CSSProperties; keyboardOpen: boolean } {
  const [area, setArea] = useState<{ top: number; height: number; full: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) {
      setArea(null);
      return;
    }
    const read = () => setArea({ top: viewport.offsetTop, height: viewport.height, full: window.innerHeight });
    read();
    viewport.addEventListener("resize", read);
    viewport.addEventListener("scroll", read);
    return () => {
      viewport.removeEventListener("resize", read);
      viewport.removeEventListener("scroll", read);
    };
  }, [active]);
  if (!area) return { style: {}, keyboardOpen: false };
  return {
    style: { "--inbox-top": `${area.top}px`, "--inbox-height": `${area.height}px` } as React.CSSProperties,
    keyboardOpen: area.full - area.height > 120,
  };
}

interface ConversationThreadProps {
  inbox: Inbox;
  /** On a phone: the chat covers the screen. */
  isOpen: boolean;
  onBack: () => void;
  onToggleRail: () => void;
  railOpen: boolean;
  draft: Draft;
  onDraft: (conversationId: string, draft: Draft) => void;
  onOpenProducts: () => void;
}

/** The open chat: who it is with, who answers it, its messages and the reply box. */
export const ConversationThread: React.FC<ConversationThreadProps> = ({ inbox, isOpen, onBack, onToggleRail, railOpen, draft, onDraft, onOpenProducts }) => {
  const c = inbox.active;
  const meta = inbox.meta;
  const { style, keyboardOpen } = useVisibleArea(isOpen);

  if (!c || !meta) {
    return (
      <section className={`${styles.card} ${styles.thread}`} aria-label="Conversation">
        <div className={styles.message}>
          <strong>Select a conversation</strong>
          <span>Choose a chat from the list to read it and reply.</span>
        </div>
      </section>
    );
  }

  const name = customerName(c);
  const answering = answeringOf(c, meta.viewer_id);
  const sentence = answeringText(c, meta.viewer_id, meta.agent_mode, inbox.now);
  const isDone = answering === "DONE";
  const isBusy = inbox.busy === "control" || inbox.busy === "assign" || inbox.busy === "resolve";
  const subtitle = [channelName(c.channel_type), c.customer?.phone].filter(Boolean).join(", ");
  const strip = answering === "NEEDS" ? styles.stripNeeds : answering === "AGENT" ? styles.stripAgent : "";

  return (
    <section
      className={`${styles.card} ${styles.thread} ${isOpen ? styles.threadOpen : ""} ${keyboardOpen ? styles.keyboardOpen : ""}`}
      style={style}
      aria-label={`Conversation with ${name}`}
    >
      <div className={styles.threadHead}>
        <button type="button" className={`${styles.iconButton} ${styles.iconButtonLarge} ${styles.back}`} onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <span className={`${styles.avatar} ${styles.avatarLarge} ${answering === "AGENT" ? styles.avatarAgent : ""}`} aria-hidden="true">
          {initialsOf(name)}
        </span>
        <div className={styles.threadWho}>
          <h2 className={styles.threadName}>{name}</h2>
          <p className={styles.threadSub}>{subtitle}</p>
        </div>
        <AnswerSwitch inbox={inbox} />
        <button
          type="button"
          className={`${styles.soft} ${styles.resolve}`}
          onClick={() => void (isDone ? inbox.reopen() : inbox.resolve())}
          disabled={inbox.busy === "resolve"}
          aria-label={isDone ? "Reopen" : "Resolve"}
        >
          {isDone ? <RotateCcw size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}
          <span className={styles.resolveLabel}>{isDone ? "Reopen" : "Resolve"}</span>
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.iconButtonLarge}`}
          onClick={onToggleRail}
          aria-label="Customer details"
          aria-pressed={railOpen}
          title="Customer details"
        >
          <PanelRight size={18} aria-hidden="true" />
        </button>
      </div>

      {/* Always in view: the only way back to the agent must not scroll away (MR2) */}
      <div className={`${styles.strip} ${strip}`} role="status">
        <span className={styles.stripText}>
          <strong>{sentence.title}</strong> {sentence.detail}
        </span>
        <span className={styles.stripFields}>
          <HandlingSelects inbox={inbox} idPrefix="strip" />
        </span>
        {isDone ? (
          <button type="button" className={styles.stripAction} disabled={isBusy} onClick={() => void inbox.reopen()}>
            Reopen
          </button>
        ) : answering === "ME" ? (
          <button type="button" className={styles.stripAction} disabled={isBusy || meta.agent_mode === "OFF"} onClick={() => void inbox.giveToAgent()}>
            ✦ Give to AI
          </button>
        ) : (
          <button type="button" className={styles.stripAction} disabled={isBusy} onClick={() => void inbox.takeOver()}>
            Take over
          </button>
        )}
      </div>

      <ActionNotices inbox={inbox} />
      <MessageStream inbox={inbox} />
      <Composer inbox={inbox} draft={draft} onDraft={onDraft} onOpenProducts={onOpenProducts} />
    </section>
  );
};
