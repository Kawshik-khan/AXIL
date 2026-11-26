"use client";

import React from "react";
import type { InboxMeta, InboxQueue } from "@/domains/social/conversations/inbox-queue";
import { QUEUE_LABELS, duration } from "./inbox-view";
import styles from "./Inbox.module.css";

interface QueueTilesProps {
  meta: InboxMeta | null;
  selected: InboxQueue | null;
  now: number;
  onSelect: (queue: InboxQueue | null) => void;
}

/** Who has to act next, as four counts that filter the list. Pressing the selected one clears it. */
export const QueueTiles: React.FC<QueueTilesProps> = ({ meta, selected, now, onSelect }) => {
  const queues = meta?.queues;
  const hints: Record<InboxQueue, string | null> = {
    NEEDS_PERSON: queues?.oldest_waiting_since ? `Oldest ${duration(now - Date.parse(queues.oldest_waiting_since))}` : null,
    AGENT: meta?.agent_mode === "OFF" ? "Off" : meta?.agent_mode === "SHADOW" ? "Drafts only" : null,
    TEAM: queues && queues.mine > 0 ? `${queues.mine} yours` : null,
    DONE: null,
  };
  const tone: Partial<Record<InboxQueue, string>> = { NEEDS_PERSON: styles.tileNeeds, AGENT: styles.tileAgent };

  return (
    <div className={styles.tiles} role="group" aria-label="Filter by who is answering">
      {(["NEEDS_PERSON", "AGENT", "TEAM", "DONE"] as const).map((queue) => (
        <button
          key={queue}
          type="button"
          className={`${styles.tile} ${tone[queue] ?? ""}`}
          aria-pressed={selected === queue}
          onClick={() => onSelect(selected === queue ? null : queue)}
        >
          <span className={styles.tileLabel}>{queue === "AGENT" ? "✦ AI agent" : QUEUE_LABELS[queue]}</span>
          <span className={styles.tileRow}>
            {/* Not loaded is not zero */}
            <span className={styles.tileCount}>{queues ? queues[queue] : "–"}</span>
            {hints[queue] && <span className={styles.tileHint}>{hints[queue]}</span>}
          </span>
        </button>
      ))}
    </div>
  );
};
