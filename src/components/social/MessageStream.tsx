"use client";

import React, { useEffect, useRef } from "react";
import { BookOpen, Lock } from "lucide-react";
import type { Message } from "@/types/social";
import { readProductCards } from "@/lib/product-card-shape";
import { LoadingSkeleton } from "@/components/ui/States/States";
import { ProductCardList } from "./ProductCardList";
import { ShadowDraftCard, isShadowDraft } from "./ShadowDraftCard";
import { clock, dayLabel, sentenceCase } from "./inbox-view";
import type { Inbox } from "./useInbox";
import styles from "./Inbox.module.css";

/** What an outbound message's status says, in words. A failure says what went wrong; nothing is shown as sent that wasn't. */
function DeliveryState({ message }: { message: Message }) {
  switch (message.status) {
    case "READ":
      return <>Read</>;
    case "DELIVERED":
      return <>Delivered</>;
    case "SENT":
    case "PROCESSED":
      return <>Sent</>;
    case "CANCELLED":
      return <span className={styles.failed}>Cancelled</span>;
    case "FAILED": {
      const notConnected = message.failure_reason?.includes("INTEGRATION_NOT_CONFIGURED") || message.failure_reason?.includes("is not connected");
      return (
        <span className={styles.failed} title={message.failure_reason}>
          {notConnected ? "Not delivered: channel sending isn't connected" : "Not delivered"}
        </span>
      );
    }
    default:
      return <>Sending</>;
  }
}

function MessageItem({ message, viewerId }: { message: Message; viewerId: string }) {
  const time = clock(message.created_at);

  if (message.message_type === "INTERNAL_NOTE") {
    return (
      <div className={styles.note} role="note">
        <Lock size={14} aria-hidden="true" />
        <span>
          <strong>
            {String(message.metadata?.author_name || "Team")}, team only, {time}.
          </strong>{" "}
          {message.text}
        </span>
      </div>
    );
  }
  if (message.message_type === "SYSTEM_EVENT" || message.sender_type === "SYSTEM") {
    return (
      <div className={styles.system}>
        {message.text}, {time}
      </div>
    );
  }

  const cards = message.message_type === "PRODUCT" ? readProductCards(message.metadata?.product_cards) : [];
  const body = cards.length > 0 ? <ProductCardList cards={cards} /> : message.text || sentenceCase(message.message_type);

  if (message.direction === "INBOUND") {
    return (
      <div className={`${styles.bubbleRow} ${styles.bubbleIn}`}>
        <div className={styles.bubble}>{body}</div>
        <span className={styles.bubbleMeta}>{time}</span>
      </div>
    );
  }

  const isAi = message.sender_type === "BOT" || Boolean(message.metadata?.is_ai);
  const confidence = Number(message.metadata?.confidence);
  return (
    <div className={`${styles.bubbleRow} ${styles.bubbleOut}`}>
      <div className={`${styles.bubble} ${isAi ? styles.bubbleAgent : ""}`}>
        {isAi ? <div>{body}</div> : body}
        {Boolean(message.metadata?.policy_citation) && (
          <span className={styles.source}>
            <BookOpen size={13} aria-hidden="true" />
            {String(message.metadata.policy_citation)}
          </span>
        )}
      </div>
      <span className={styles.bubbleMeta}>
        {isAi ? "✦ AI agent" : message.sender_id === viewerId ? "You" : "Team"}, {time}
        {isAi && Number.isFinite(confidence) && confidence > 0 ? `, ${Math.round(confidence * 100)}% match` : ""}, <DeliveryState message={message} />
      </span>
    </div>
  );
}

/** The open chat's messages, oldest first, kept at the newest. */
export const MessageStream: React.FC<{ inbox: Inbox }> = ({ inbox }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { active, messages } = inbox;
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.id, lastId]);

  // The area shrinks when the keyboard opens or the reply box grows: the newest message stays in view
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const wasAtEnd = el.scrollHeight - el.scrollTop - height < 40;
      height = el.clientHeight;
      if (wasAtEnd) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shadow = active?.metadata?.agent_shadow_reply;
  let day = "";
  return (
    <div ref={ref} className={`${styles.scroll} ${styles.stream}`} tabIndex={0} aria-label="Messages">
      {inbox.isLoadingMessages && messages.length === 0 && <LoadingSkeleton lines={4} inline />}
      {inbox.messagesError && (
        <div className={styles.message} role="alert">
          <strong>Messages could not be loaded</strong>
          <span>{inbox.messagesError.message}</span>
          {inbox.messagesError.request_id && <code>{inbox.messagesError.request_id}</code>}
          <button type="button" className={styles.soft} onClick={inbox.retryMessages}>
            Retry
          </button>
        </div>
      )}
      {!inbox.isLoadingMessages && !inbox.messagesError && messages.length === 0 && (
        <div className={styles.message}>
          <strong>No messages yet</strong>
        </div>
      )}
      {inbox.canLoadEarlier && (
        <div className={styles.day}>
          <button type="button" className={styles.soft} onClick={inbox.loadEarlier} disabled={inbox.isLoadingMessages}>
            Show earlier messages
          </button>
        </div>
      )}
      {messages.map((message) => {
        const label = dayLabel(message.created_at, inbox.now);
        const isNewDay = label !== day;
        day = label;
        return (
          <React.Fragment key={message.id}>
            {isNewDay && <div className={styles.day}>{label}</div>}
            <MessageItem message={message} viewerId={inbox.meta?.viewer_id ?? ""} />
          </React.Fragment>
        );
      })}
      {active && isShadowDraft(shadow) && <ShadowDraftCard key={shadow.run_id} conversationId={active.id} draft={shadow} />}
    </div>
  );
};
