"use client";

import React from "react";
import { Globe, MessageSquare, RefreshCw, Search } from "lucide-react";
import { BrandIcon, brandFor } from "@/components/brand/BrandIcon";
import type { InboxConversation, InboxQueue } from "@/domains/social/conversations/inbox-queue";
import { LoadingSkeleton } from "@/components/ui/States/States";
import { QUEUE_LABELS, answeringOf, channelName, customerName, initialsOf, listTime, replyClock, sentenceCase } from "./inbox-view";
import type { Inbox } from "./useInbox";
import styles from "./Inbox.module.css";

const CHANNELS = ["WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM", "TELEGRAM", "WEBSITE_CHAT"] as const;
const RING = 2 * Math.PI * 20;

export const ChannelMark: React.FC<{ type: string; size: number; label?: boolean }> = ({ type, size, label = false }) => {
  const brand = brandFor(type);
  if (brand) return <BrandIcon brand={brand} size={size} label={label ? true : undefined} />;
  const Icon = type === "WEBSITE_CHAT" ? Globe : MessageSquare;
  return <Icon size={size} aria-hidden={label ? undefined : true} aria-label={label ? channelName(type) : undefined} role={label ? "img" : undefined} />;
};

function previewOf(c: InboxConversation): string {
  const m = c.last_message;
  if (!m) return c.subject || "No messages yet";
  const text = m.text.trim() || sentenceCase(m.message_type);
  if (m.direction === "INBOUND") return text;
  return m.is_ai ? `✦ ${text}` : `Team: ${text}`;
}

function OwnerChip({ c, viewerId, now }: { c: InboxConversation; viewerId: string; now: number }) {
  switch (answeringOf(c, viewerId)) {
    case "NEEDS": {
      const reply = replyClock(c, now);
      if (reply?.overdue) return <span className={`${styles.chip} ${styles.chipOver}`}>Overdue {reply.amount}</span>;
      return <span className={`${styles.chip} ${styles.chipNeeds}`}>{reply ? `${reply.amount} left` : "Needs a person"}</span>;
    }
    case "AGENT":
      return <span className={`${styles.chip} ${styles.chipAgent}`}>✦ AI agent</span>;
    case "ME":
      return <span className={`${styles.chip} ${styles.chipMe}`}>You</span>;
    case "OTHER":
      return <span className={styles.chip}>{c.owner?.name ?? "Your team"}</span>;
    default:
      return <span className={styles.chip}>{sentenceCase(c.status)}</span>;
  }
}

function Row({ c, inbox, selected, onOpen }: { c: InboxConversation; inbox: Inbox; selected: boolean; onOpen: (c: InboxConversation) => void }) {
  const viewerId = inbox.meta?.viewer_id ?? "";
  const name = customerName(c);
  const reply = c.queue === "NEEDS_PERSON" ? replyClock(c, inbox.now) : undefined;
  const waiting = c.queue === "TEAM" ? c.awaiting_count ?? 0 : 0;
  return (
    <button type="button" className={`${styles.row} ${c.unread_count > 0 ? styles.rowUnread : ""}`} aria-current={selected ? "true" : undefined} onClick={() => onOpen(c)}>
      <span className={styles.avatarBox}>
        {reply && (
          <svg className={styles.avatarRing} width={44} height={44} viewBox="0 0 44 44" aria-hidden="true">
            <circle cx={22} cy={22} r={20} strokeWidth={3} className={styles.ringTrack} />
            <circle
              cx={22}
              cy={22}
              r={20}
              strokeWidth={3}
              className={reply.overdue ? styles.ringOver : styles.ringLeft}
              strokeDasharray={reply.overdue ? undefined : `${reply.left * RING} ${RING}`}
            />
          </svg>
        )}
        <span className={`${styles.avatar} ${c.queue === "AGENT" ? styles.avatarAgent : ""}`}>{initialsOf(name)}</span>
        <span className={styles.avatarChannel}>
          <ChannelMark type={c.channel_type} size={15} label />
        </span>
      </span>
      <span className={styles.rowBody}>
        <span className={styles.rowTop}>
          <span className={styles.rowName}>{name}</span>
          <span className={styles.rowTime}>{listTime(c.last_message_at, inbox.now)}</span>
        </span>
        <span className={styles.rowPreview}>{previewOf(c)}</span>
        <span className={styles.rowMeta}>
          <span className={styles.chips}>
            <OwnerChip c={c} viewerId={viewerId} now={inbox.now} />
            {waiting > 0 && <span className={`${styles.chip} ${styles.chipNeeds}`}>{waiting} waiting</span>}
            {c.tags[0] && <span className={styles.chip}>{sentenceCase(c.tags[0])}</span>}
          </span>
          {c.unread_count > 0 && (
            <span className={styles.unread} aria-label={`${c.unread_count} unread`}>
              {c.unread_count}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

const DOT: Partial<Record<InboxQueue, string>> = { NEEDS_PERSON: styles.dotNeeds, AGENT: styles.dotAgent, TEAM: styles.dotTeam };

/** The conversation list: search, channel filter, and chats grouped by who has to act next. */
export const UnifiedInbox: React.FC<{ inbox: Inbox; onOpen: (c: InboxConversation) => void }> = ({ inbox, onOpen }) => {
  const { meta, conversations } = inbox;
  const counts = meta?.channels ?? {};
  const allCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const groups = (["NEEDS_PERSON", "AGENT", "TEAM", "DONE"] as const)
    .map((queue) => ({ queue, rows: conversations.filter((c) => c.queue === queue) }))
    .filter((g) => g.rows.length > 0);
  // With a search or a channel filter the tiles' totals don't describe what is listed
  const isNarrowed = Boolean(inbox.channel || inbox.query.trim());

  return (
    <section className={`${styles.card} ${styles.list}`} aria-label="Conversations">
      <div className={styles.listHead}>
        <div className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <label className={styles.srOnly} htmlFor="inbox-search">
            Search conversations
          </label>
          <input id="inbox-search" type="search" placeholder="Name or phone" value={inbox.query} onChange={(e) => inbox.setQuery(e.target.value)} />
          <button type="button" className={styles.iconButton} onClick={inbox.refresh} aria-label="Refresh conversations" title="Refresh" disabled={inbox.isRefreshing}>
            <RefreshCw size={15} className={inbox.isRefreshing ? styles.spinning : undefined} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.channels} role="group" aria-label="Filter by channel">
          <button type="button" aria-pressed={!inbox.channel} onClick={() => inbox.setChannel(null)} title="All channels">
            All <span>{meta ? allCount : "–"}</span>
          </button>
          {/* A channel without chats is left out, unless it is the selected one */}
          {CHANNELS.filter((type) => (counts[type] ?? 0) > 0 || inbox.channel === type).map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={inbox.channel === type}
              aria-label={`${channelName(type)}, ${counts[type] ?? 0}`}
              title={channelName(type)}
              onClick={() => inbox.setChannel(inbox.channel === type ? null : type)}
            >
              <ChannelMark type={type} size={17} />
              <span>{counts[type] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.scroll} ${styles.rows}`}>
        {inbox.isLoading ? (
          <LoadingSkeleton lines={6} inline />
        ) : inbox.listError && conversations.length === 0 ? (
          <div className={styles.message} role="alert">
            <strong>The inbox could not be loaded</strong>
            <span>{inbox.listError.message}</span>
            {inbox.listError.request_id && <code>{inbox.listError.request_id}</code>}
            {inbox.listError.status === 401 && <a href="/login">Sign in again</a>}
            <button type="button" className={styles.soft} onClick={inbox.refresh}>
              Retry
            </button>
          </div>
        ) : groups.length === 0 && !inbox.queue && !isNarrowed ? (
          <div className={styles.message}>
            <strong>Nothing is open</strong>
            <span>Every conversation is resolved.</span>
            <button type="button" className={styles.soft} onClick={() => inbox.setQueue("DONE")}>
              Show resolved
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className={styles.message}>
            <strong>No conversations match</strong>
            <span>Clear the queue, channel or search to see the rest.</span>
            <button type="button" className={styles.soft} onClick={inbox.clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {inbox.listError && (
              <div className={styles.message} role="alert">
                <span>Could not refresh: {inbox.listError.message}</span>
              </div>
            )}
            {groups.map(({ queue, rows }) => (
              <div key={queue}>
                <h2 className={styles.groupHead}>
                  <i className={DOT[queue]} aria-hidden="true" />
                  {QUEUE_LABELS[queue]}
                  {meta && !isNarrowed && <span>{meta.queues[queue]}</span>}
                </h2>
                {rows.map((c) => (
                  <Row key={c.id} c={c} inbox={inbox} selected={c.id === inbox.active?.id} onOpen={onOpen} />
                ))}
              </div>
            ))}
            {inbox.canLoadMore && (
              <div className={styles.message}>
                <button type="button" className={styles.soft} onClick={inbox.loadMore}>
                  Show more
                </button>
              </div>
            )}
            {inbox.isCutOff && (
              <div className={styles.message}>
                <span>
                  Showing the first {conversations.length} of {meta?.total}. Search or pick a queue or channel to find the others.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
