"use client";

import React, { useEffect, useRef, useState } from "react";
import { Lock, Package, Send, X, Zap } from "lucide-react";
import { AiModeBadge } from "@/components/ai/AiModeBadge";
import { api } from "@/components/payments/api";
import { sentenceCase } from "./inbox-view";
import type { Inbox } from "./useInbox";
import styles from "./Inbox.module.css";

interface Suggestion {
  suggested_reply: string;
  intent: string;
  confidence: number | null;
}

/** What is in a chat's reply box. A team note stays a note: it must never come back as a reply to the customer. */
export interface Draft {
  text: string;
  isNote: boolean;
}

export const EMPTY_DRAFT: Draft = { text: "", isNote: false };

interface ComposerProps {
  inbox: Inbox;
  draft: Draft;
  onDraft: (conversationId: string, draft: Draft) => void;
  onOpenProducts: () => void;
}

/** The reply box: reply or team note, quick replies, a product from the catalog, and a draft from the AI copilot. */
export const Composer: React.FC<ComposerProps> = ({ inbox, draft, onDraft, onOpenProducts }) => {
  const conversationId = inbox.active?.id ?? "";
  const { text: draftText, isNote } = draft;
  const setIsNote = (next: boolean) => onDraft(conversationId, { text: draftText, isNote: next });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const repliesRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const shownFor = useRef(conversationId);
  shownFor.current = conversationId;

  // A suggestion belongs to the chat it was made for
  useEffect(() => {
    setSuggestion(null);
    setShowReplies(false);
    setIsDrafting(false);
  }, [conversationId]);

  useEffect(() => {
    if (!showReplies) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!repliesRef.current?.contains(event.target as Node)) setShowReplies(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowReplies(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showReplies]);

  const isSending = inbox.busy === "send";

  const submit = async () => {
    const id = conversationId;
    const text = draftText.trim();
    if (!text || isSending) return;
    // The text stays in the box when the server refuses it. Another chat may be open by the time it answers.
    if (await inbox.send(text, isNote)) {
      onDraft(id, EMPTY_DRAFT);
      if (shownFor.current === id) setSuggestion(null);
    }
  };

  const draftReply = async () => {
    const id = conversationId;
    setIsDrafting(true);
    setSuggestion(null);
    inbox.dismissError();
    const result = await api<Suggestion>("/api/v1/ai/copilot/suggest", { method: "POST", json: { conversation_id: id } });
    if (shownFor.current !== id) return;
    setIsDrafting(false);
    if (result.ok && result.data?.suggested_reply) {
      setSuggestion(result.data);
    } else {
      inbox.showError({ status: result.status, ...(result.error ?? { code: "NO_DRAFT", message: "The AI copilot returned no draft." }) });
    }
  };

  const fill = (text: string) => {
    onDraft(conversationId, { text, isNote: false });
    setSuggestion(null);
    setShowReplies(false);
    textRef.current?.focus();
  };

  /** A quick reply is added to what is already typed, as a reply or a note alike. */
  const addText = (text: string) => {
    onDraft(conversationId, { text: draftText.trim() ? `${draftText}\n${text}` : text, isNote });
    setShowReplies(false);
    textRef.current?.focus();
  };

  return (
    <div className={styles.composer}>
      {suggestion && (
        <div className={styles.suggestion}>
          <span className={styles.suggestionText} title={suggestion.suggested_reply}>
            {/* The modes row that carries the badge is hidden on a phone */}
            <span className={styles.phoneOnly}>
              <AiModeBadge style={{ marginRight: "6px" }} />
            </span>
            <strong>
              ✦ Draft
              <span className={styles.suggestionInfo}>
                {suggestion.intent ? `, ${sentenceCase(suggestion.intent).toLowerCase()}` : ""}
                {typeof suggestion.confidence === "number" ? `, ${Math.round(suggestion.confidence * 100)}% confident` : ""}
              </span>
              .
            </strong>{" "}
            {suggestion.suggested_reply}
          </span>
          <span className={styles.suggestionActions}>
            <button type="button" className={styles.agentButton} onClick={() => fill(suggestion.suggested_reply)}>
              Use draft
            </button>
            <button type="button" className={`${styles.iconButton} ${styles.iconButtonLarge}`} onClick={() => setSuggestion(null)} aria-label="Dismiss draft">
              <X size={16} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}

      <div className={`${styles.composerField} ${isNote ? styles.composerNote : ""}`}>
        <div className={styles.modes} role="group" aria-label="Message type">
          <button type="button" aria-pressed={!isNote} onClick={() => setIsNote(false)}>
            Reply
          </button>
          <button type="button" aria-pressed={isNote} onClick={() => setIsNote(true)}>
            Team note
          </button>
          <AiModeBadge />
        </div>
        <label className={styles.srOnly} htmlFor="inbox-message">
          {isNote ? "Team note" : "Reply"}
        </label>
        <textarea
          ref={textRef}
          id="inbox-message"
          rows={1}
          value={draftText}
          placeholder={isNote ? "Only your team sees this" : "Reply in Bangla, English or Banglish"}
          onChange={(e) => onDraft(conversationId, { text: e.target.value, isNote })}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
            e.preventDefault();
            void submit();
          }}
        />
        <div className={styles.tools}>
          <div className={styles.toolsLeft}>
            <button type="button" className={`${styles.tool} ${styles.toolNote}`} aria-label="Team note" aria-pressed={isNote} onClick={() => setIsNote(!isNote)}>
              <Lock size={17} aria-hidden="true" />
              {isNote && "Note"}
            </button>
            <button type="button" className={`${styles.tool} ${styles.toolAgent}`} onClick={() => void draftReply()} disabled={isDrafting}>
              {isDrafting ? "✦ Drafting" : "✦ Draft reply"}
            </button>
            <div className={styles.popAnchor} ref={repliesRef}>
              <button type="button" className={styles.tool} aria-label="Quick replies" aria-expanded={showReplies} onClick={() => setShowReplies(!showReplies)}>
                <Zap size={15} aria-hidden="true" />
                <span className={styles.toolLabel}>Quick replies</span>
              </button>
              {showReplies && (
                <div className={`${styles.pop} ${styles.scroll}`}>
                  {inbox.quickRepliesError ? (
                    <p role="alert">Quick replies could not be loaded: {inbox.quickRepliesError.message}</p>
                  ) : (
                    inbox.quickReplies.length === 0 && <p>No quick replies saved yet.</p>
                  )}
                  {inbox.quickReplies.map((reply) => (
                    <button key={reply.id} type="button" onClick={() => addText(reply.content)}>
                      <strong>{reply.title}</strong>
                      <span>{reply.content}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className={styles.tool} aria-label="Product" onClick={onOpenProducts}>
              <Package size={15} aria-hidden="true" />
              <span className={styles.toolLabel}>Product</span>
            </button>
          </div>
          <div className={styles.toolsRight}>
            <span className={styles.shortcut}>Ctrl Enter</span>
            <button type="button" className={styles.ink} onClick={() => void submit()} disabled={!draftText.trim() || isSending} aria-label={isNote ? "Add note" : "Send"}>
              <span className={styles.toolLabel}>{isSending ? "Sending" : isNote ? "Add note" : "Send"}</span>
              <Send size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
