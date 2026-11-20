"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eraser, Loader2, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { BentoCard } from "@/components/bento/BentoCard";
import { Button } from "@/components/ui/Button/Button";
import { Modal } from "@/components/ui/Modal/Modal";
import { ErrorState, LoadingSkeleton, PermissionDenied } from "@/components/ui/States/States";
import dashStyles from "../dashboard.module.css";
import styles from "./assistant.module.css";

interface Turn {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  mode: "LIVE" | "BASIC" | "REFUSED" | null;
  tools_used: string[];
  created_at: string;
}

interface ApiError {
  message: string;
  requestId?: string;
  status: number;
}

const SUGGESTIONS = [
  "How much did I sell today?",
  "Which products sold best this week?",
  "What is low on stock?",
  "How many deliveries failed last week?",
  "আজ কত বিক্রি হলো?",
  "How much COD is still with couriers?",
];

const MAX_CHARS = 1000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err: ApiError = { status: res.status, message: body?.error?.message ?? "Something went wrong.", requestId: body?.error?.request_id };
    throw err;
  }
  return body?.data as T;
}

const asError = (err: unknown): ApiError =>
  typeof err === "object" && err && "status" in err ? (err as ApiError) : { status: 0, message: "Couldn't reach CommerceOS. Check your connection." };

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * Ask your shop (Owner Assistant, ADR-127): the owner asks about sales, stock, deliveries, returns and cash on
 * delivery in English, Banglish or Bangla, and gets answers from the shop's own numbers. Read-only: it never changes
 * anything. States: loading, error (with reference), no permission, empty (suggested questions), sending, answered,
 * offline answer (no AI model connected).
 */
export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await call<{ turns: Turn[] }>("/api/v1/ai/owner-assistant/messages");
      setTurns(data.turns);
      setLoadError(null);
    } catch (err) {
      setLoadError(asError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, pending]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    setPending(q);
    setSendError(null);
    setQuestion("");
    try {
      const data = await call<{ turn: Turn }>("/api/v1/ai/owner-assistant/messages", { method: "POST", body: JSON.stringify({ question: q }) });
      setTurns((t) => [...(t ?? []), data.turn]);
    } catch (err) {
      setSendError(asError(err));
      setQuestion(q); // keep what they typed, so they can retry
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };

  const clearChat = async () => {
    setClearing(true);
    try {
      await call("/api/v1/ai/owner-assistant/messages", { method: "DELETE" });
      setTurns([]);
      setConfirmClear(false);
    } catch (err) {
      setSendError(asError(err));
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  };

  const header = (
    <header className={dashStyles.pageHeader}>
      <div>
        <div className={dashStyles.pageEyebrow}>Owner assistant</div>
        <h1 className={dashStyles.pageTitle}>Ask your shop</h1>
        <p className={dashStyles.pageDescription}>Questions about sales, stock, deliveries and cash, answered from your own numbers.</p>
      </div>
    </header>
  );

  if (loadError?.status === 403) {
    return (
      <div className={styles.page}>
        {header}
        <PermissionDenied resource="the owner assistant" requiredPermission="ai.run" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className={styles.page}>
        {header}
        <ErrorState title="Couldn't load your chat" message={loadError.message} requestId={loadError.requestId} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      <BentoGrid>
        <BentoCard span={8} className={styles.chatCard}>
          <div className={styles.thread} aria-live="polite">
            {turns === null ? (
              <LoadingSkeleton lines={6} />
            ) : turns.length === 0 && !pending ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <MessageCircleQuestion size={22} />
                </div>
                <h2 className={styles.emptyTitle}>What would you like to know?</h2>
                <p className={styles.muted}>Ask in English, Banglish or Bangla. Every number comes from your shop&apos;s data.</p>
                <div className={styles.chips}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className={styles.chip} onClick={() => void ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {turns.map((t) => (
                  <div key={t.id} className={styles.pair}>
                    <div className={styles.question}>
                      <p>{t.question}</p>
                      <span className={styles.meta}>{time(t.created_at)}</span>
                    </div>
                    <div className={styles.answer}>
                      <p>{t.answer ?? (t.status === "FAILED" ? "This question couldn't be answered." : "Answering…")}</p>
                      {t.mode === "BASIC" && <span className={styles.badge}>Basic answer · straight from your data</span>}
                    </div>
                  </div>
                ))}
                {pending && (
                  <div className={styles.pair}>
                    <div className={styles.question}>
                      <p>{pending}</p>
                    </div>
                    <div className={`${styles.answer} ${styles.thinking}`}>
                      <Loader2 size={16} className={styles.spin} />
                      <span>Checking your numbers…</span>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={endRef} />
          </div>

          {sendError && (
            <p className={styles.error} role="alert">
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
            <label htmlFor="assistant-question" className={styles.srOnly}>
              Your question
            </label>
            <textarea
              id="assistant-question"
              ref={inputRef}
              className={styles.input}
              rows={2}
              maxLength={MAX_CHARS}
              placeholder="Ask about sales, stock, deliveries…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              disabled={pending !== null}
            />
            <Button type="submit" variant="primary" disabled={!question.trim() || pending !== null} aria-label="Ask">
              {pending ? <Loader2 size={16} className={styles.spin} /> : <Send size={16} />}
              Ask
            </Button>
          </form>
        </BentoCard>

        <BentoCard span={4} title="How it works" className={styles.sideCard}>
          <ul className={styles.points}>
            <li>
              <Sparkles size={16} />
              <span>Answers use only numbers read from your shop at the moment you ask. If something isn&apos;t in your data, it says so.</span>
            </li>
            <li>
              <MessageCircleQuestion size={16} />
              <span>It only reads. To change an order, price or stock, use the pages for them.</span>
            </li>
            <li>
              <Send size={16} />
              <span>
                Ask from your phone too: connect Telegram in{" "}
                <Link href="/settings#notifications" className={styles.link}>
                  Settings → Notifications
                </Link>{" "}
                and message the bot.
              </span>
            </li>
          </ul>
          {turns && turns.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} className={styles.clear}>
              <Eraser size={14} />
              Clear this chat
            </Button>
          )}
        </BentoCard>
      </BentoGrid>

      <Modal isOpen={confirmClear} onClose={() => setConfirmClear(false)} title="Clear this chat?">
        <p className={styles.muted}>Your questions and answers here are deleted. This doesn&apos;t affect your Telegram chat.</p>
        <div className={styles.modalActions}>
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => void clearChat()} disabled={clearing}>
            {clearing ? <Loader2 size={16} className={styles.spin} /> : <Eraser size={16} />}
            Clear
          </Button>
        </div>
      </Modal>
    </div>
  );
}
