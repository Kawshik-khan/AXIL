"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Loader2, Maximize2, RotateCcw, Sparkles, X } from "lucide-react";
import { ASSISTANT_MAX_CHARS, ASSISTANT_SUGGESTIONS, useOwnerAssistant } from "./use-owner-assistant";
import styles from "./AssistantCard.module.css";

interface AssistantCardProps {
  open: boolean;
  onClose: () => void;
  readOnly: boolean;
}

/**
 * The floating "Ask your shop" chat card: violet glass, a greeting and suggested questions when the chat is empty,
 * the thread otherwise, and a composer with the send button set into its top edge. Same route and rules as the
 * /assistant page (read-only answers from the shop's own numbers). States: loading, error with reference and retry,
 * no permission, empty, sending, answered, basic (offline) answer, read-only support session.
 */
export function AssistantCard({ open, onClose, readOnly }: AssistantCardProps) {
  const { turns, loadError, pending, sendError, load, ask: send } = useOwnerAssistant();
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Fresh history on every open (the Telegram chat or the full page may have added turns meanwhile).
  useEffect(() => {
    if (!open) return;
    void load();
    inputRef.current?.focus();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    // scroll the card's own body, never the page behind it
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || pending || readOnly) return;
    setQuestion("");
    const ok = await send(q);
    if (!ok) setQuestion(q); // keep what they typed, so they can retry
    inputRef.current?.focus();
  };

  const empty = turns !== null && turns.length === 0 && !pending;
  const noPermission = loadError?.status === 403;

  let body: React.ReactNode;
  if (noPermission) {
    body = (
      <div className={styles.notice}>
        <p className={styles.greeting}>This needs a different role.</p>
        <p className={styles.soft}>Asking your shop needs the ai.run permission. Ask the workspace owner to add it to your role.</p>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className={styles.notice} role="alert">
        <p className={styles.greetingSmall}>Couldn&apos;t load your chat.</p>
        <p className={styles.soft}>
          {loadError.message}
          {loadError.requestId ? <span className={styles.ref}> · Ref {loadError.requestId}</span> : null}
        </p>
        <button type="button" className={styles.chip} onClick={() => void load()}>
          <RotateCcw size={14} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  } else if (turns === null) {
    body = (
      <div className={styles.skeleton} aria-label="Loading your chat">
        <span />
        <span />
        <span />
      </div>
    );
  } else if (empty) {
    body = (
      <div className={styles.welcome}>
        <p className={styles.greeting}>What would you like to know about your shop today?</p>
        <p className={styles.soft}>Ask in English, Banglish or Bangla. Every number comes from your own data.</p>
        {!readOnly && (
          <div className={styles.chips}>
            {ASSISTANT_SUGGESTIONS.slice(0, 4).map((s) => (
              <button key={s} type="button" className={styles.chip} onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <ol className={styles.thread}>
        {turns.map((t) => (
          <li key={t.id} className={styles.pair}>
            <p className={styles.question}>{t.question}</p>
            <div className={styles.answer}>
              <Sparkles size={14} className={styles.answerMark} aria-hidden="true" />
              <div>
                <p>{t.answer ?? (t.status === "FAILED" ? "This question couldn't be answered." : "Answering…")}</p>
                {t.mode === "BASIC" && <span className={styles.badge}>Basic answer · straight from your data</span>}
              </div>
            </div>
          </li>
        ))}
        {pending && (
          <li className={styles.pair}>
            <p className={styles.question}>{pending}</p>
            <div className={`${styles.answer} ${styles.thinking}`}>
              <Loader2 size={14} className={styles.spin} aria-hidden="true" />
              <p>Checking your numbers…</p>
            </div>
          </li>
        )}
      </ol>
    );
  }

  return (
    <section
      id="ask-your-shop-card"
      role="dialog"
      aria-modal="false"
      aria-label="Ask your shop"
      className={`${styles.card} ${open ? styles.cardOpen : ""}`}
      hidden={!open}
    >
      <div className={styles.sheen} aria-hidden="true" />

      <header className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">
          <span className={styles.avatarWord}>ask</span>
        </span>
        <div className={styles.headText}>
          <span className={styles.title}>Ask your shop</span>
          <span className={styles.subtitle}>Answers from your own numbers</span>
        </div>
        <div className={styles.headActions}>
          <Link href="/assistant" className={styles.iconButton} aria-label="Open the full Ask your shop page" onClick={onClose}>
            <Maximize2 size={15} />
          </Link>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div ref={bodyRef} className={styles.body} aria-live="polite">
        {body}
      </div>

      {sendError && (
        <p className={styles.sendError} role="alert">
          {sendError.message}
          {sendError.requestId ? <span className={styles.ref}> · Ref {sendError.requestId}</span> : null}
        </p>
      )}

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <button
          type="submit"
          className={styles.send}
          disabled={readOnly || noPermission || !question.trim() || pending !== null}
          aria-label="Ask"
        >
          {pending ? <Loader2 size={18} className={styles.spin} /> : <ArrowUp size={18} />}
        </button>
        <label htmlFor="ask-your-shop-input" className={styles.srOnly}>
          Your question
        </label>
        <textarea
          id="ask-your-shop-input"
          ref={inputRef}
          className={styles.input}
          rows={2}
          maxLength={ASSISTANT_MAX_CHARS}
          placeholder={readOnly ? "Read-only support session: asking is off" : "Ask about sales, stock, deliveries…"}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          disabled={readOnly || noPermission || pending !== null}
        />
      </form>
    </section>
  );
}
