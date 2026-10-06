"use client";

/**
 * The customer agent's shadow draft for this chat (FX-87 shadow week): what the agent would have sent. Staff rate it
 * usable or not; nothing here is sent to the customer. The rating feeds the pilot go/no-go (≥ 85% usable).
 */
import React, { useState } from "react";
import { Bot, ThumbsDown, ThumbsUp } from "lucide-react";
import styles from "./SocialInbox.module.css";

export interface ShadowDraft {
  text: string;
  run_id: string;
  status?: string;
  at?: string;
  rating?: { value: "USABLE" | "NOT_USABLE"; at: string };
}

export function isShadowDraft(value: unknown): value is ShadowDraft {
  const v = value as Partial<ShadowDraft> | null;
  return Boolean(v && typeof v.text === "string" && typeof v.run_id === "string");
}

export function ShadowDraftCard({ conversationId, draft }: { conversationId: string; draft: ShadowDraft }) {
  const [rating, setRating] = useState(draft.rating?.value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rate = async (value: "USABLE" | "NOT_USABLE") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/social/conversations/${encodeURIComponent(conversationId)}/agent-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "Rating failed.");
      setRating(value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.internalNoteRow} role="note" aria-label="Agent draft (not sent)">
      <div className={styles.internalNoteBubble}>
        <div className={styles.internalNoteHeader}>
          <Bot size={12} />
          <span>AGENT DRAFT • NOT SENT (shadow mode)</span>
        </div>
        <div>{draft.text}</div>
        <div style={{ display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" }}>
          {rating ? (
            <span>{rating === "USABLE" ? "Rated usable" : "Rated not usable"}</span>
          ) : (
            <>
              <span>Would you have sent this?</span>
              <button type="button" onClick={() => void rate("USABLE")} disabled={busy} aria-label="Usable">
                <ThumbsUp size={14} />
              </button>
              <button type="button" onClick={() => void rate("NOT_USABLE")} disabled={busy} aria-label="Not usable">
                <ThumbsDown size={14} />
              </button>
            </>
          )}
          {error && <span role="alert">{error}</span>}
        </div>
      </div>
    </div>
  );
}
