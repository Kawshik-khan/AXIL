"use client";

import React, { useMemo } from "react";
import { Search, MessageSquare, Phone, Globe, RefreshCw } from "lucide-react";
import { Conversation, ChannelType } from "@/types/social";
import styles from "./SocialInbox.module.css";

interface UnifiedInboxProps {
  conversations: any[];
  selectedConversationId?: string;
  onSelectConversation: (id: string) => void;
  filterChannel?: string;
  onFilterChannelChange: (ch?: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterUnreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  filterTag?: string;
  onSelectTag: (tag?: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const UnifiedInbox: React.FC<UnifiedInboxProps> = ({
  conversations,
  selectedConversationId,
  onSelectConversation,
  filterChannel,
  onFilterChannelChange,
  searchQuery,
  onSearchChange,
  filterUnreadOnly,
  onToggleUnreadOnly,
  filterTag,
  onSelectTag,
  onRefresh,
  isRefreshing,
}) => {
  const getBadgeClass = (type: ChannelType) => {
    switch (type) {
      case "FACEBOOK_MESSENGER":
        return styles.badgeFB;
      case "INSTAGRAM":
        return styles.badgeIG;
      case "WHATSAPP":
        return styles.badgeWA;
      case "WEBSITE_CHAT":
      default:
        return styles.badgeWEB;
    }
  };

  const getChannelLabel = (type: ChannelType) => {
    switch (type) {
      case "FACEBOOK_MESSENGER":
        return "FB";
      case "INSTAGRAM":
        return "IG";
      case "WHATSAPP":
        return "WA";
      case "WEBSITE_CHAT":
        return "WEB";
      default:
        return String(type).slice(0, 3);
    }
  };

  const formatRelativeTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diffSec < 60) return "Just now";
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      if (diffSec < 172800) return "Yesterday";
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  // Counts for pills
  const totalCount = conversations.length;

  // ⚡ Bolt: Optimized multiple filter passes into a single O(N) reduce
  // This reduces re-renders computation time, avoiding 5 separate array traversals on every update.
  const { unreadCount, waCount, fbCount, igCount, webCount } = useMemo(() => {
    return conversations.reduce(
      (acc, c) => {
        if (c.unread_count > 0) acc.unreadCount++;

        if (c.channel_type === "WHATSAPP") acc.waCount++;
        else if (c.channel_type === "FACEBOOK_MESSENGER") acc.fbCount++;
        else if (c.channel_type === "INSTAGRAM") acc.igCount++;
        else if (c.channel_type === "WEBSITE_CHAT") acc.webCount++;

        return acc;
      },
      { unreadCount: 0, waCount: 0, fbCount: 0, igCount: 0, webCount: 0 }
    );
  }, [conversations]);

  return (
    <div className={styles.conversationsPanel}>
      {/* Search Header */}
      <div className={styles.panelHeader}>
        <div className={styles.searchBox}>
          <Search size={15} color="#9CA3AF" />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search conversations, customers, phone..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh conversations"
              style={{
                background: "none",
                border: "none",
                color: "#6B7280",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#1F2937")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
            >
              <RefreshCw size={14} className={isRefreshing ? "spin" : ""} />
            </button>
          )}
        </div>

        {/* Channel Filter Pills across all platforms */}
        <div className={styles.filterPillsRow}>
          <button
            className={`${styles.filterBadge} ${!filterChannel && !filterUnreadOnly ? styles.filterBadgeActive : ""}`}
            onClick={() => {
              onFilterChannelChange(undefined);
              onSelectTag(undefined);
            }}
          >
            All <span className={styles.pillCount}>{totalCount}</span>
          </button>
          {unreadCount > 0 && (
            <button
              className={`${styles.filterBadge} ${filterUnreadOnly ? styles.filterBadgeActive : ""}`}
              onClick={onToggleUnreadOnly}
            >
              Unread <span className={styles.pillCount}>{unreadCount}</span>
            </button>
          )}
          <button
            className={`${styles.filterBadge} ${filterChannel === "WHATSAPP" ? styles.filterBadgeActive : ""}`}
            onClick={() => onFilterChannelChange("WHATSAPP")}
          >
            WhatsApp <span className={styles.pillCount}>{waCount}</span>
          </button>
          <button
            className={`${styles.filterBadge} ${filterChannel === "FACEBOOK_MESSENGER" ? styles.filterBadgeActive : ""}`}
            onClick={() => onFilterChannelChange("FACEBOOK_MESSENGER")}
          >
            Facebook <span className={styles.pillCount}>{fbCount}</span>
          </button>
          <button
            className={`${styles.filterBadge} ${filterChannel === "INSTAGRAM" ? styles.filterBadgeActive : ""}`}
            onClick={() => onFilterChannelChange("INSTAGRAM")}
          >
            Instagram <span className={styles.pillCount}>{igCount}</span>
          </button>
          <button
            className={`${styles.filterBadge} ${filterChannel === "WEBSITE_CHAT" ? styles.filterBadgeActive : ""}`}
            onClick={() => onFilterChannelChange("WEBSITE_CHAT")}
          >
            Website <span className={styles.pillCount}>{webCount}</span>
          </button>
        </div>
      </div>

      {/* Conversation Thread List */}
      <div className={styles.conversationList}>
        {conversations.length === 0 ? (
          <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--color-text-secondary)" }}>
            <MessageSquare size={32} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
            <p style={{ fontSize: "0.875rem", fontWeight: 600 }}>No conversations found</p>
            <p style={{ fontSize: "0.75rem", marginTop: "4px" }}>
              Try clearing filters or search term
            </p>
          </div>
        ) : (
          conversations.map((convo) => {
            const isSelected = convo.id === selectedConversationId;
            const customerName = convo.customer
              ? `${convo.customer.first_name} ${convo.customer.last_name}`
              : `Customer (${String(convo.external_conversation_id || convo.id).slice(-6)})`;

            const initials = convo.customer?.first_name
              ? convo.customer.first_name.charAt(0).toUpperCase()
              : "C";

            return (
              <div
                key={convo.id}
                className={`${styles.conversationItem} ${isSelected ? styles.conversationItemActive : ""}`}
                onClick={() => onSelectConversation(convo.id)}
              >
                {/* Left User Avatar */}
                <div className={styles.userAvatar}>
                  {initials}
                  <span className={`${styles.avatarPlatformBadge} ${getBadgeClass(convo.channel_type)}`}>
                    {getChannelLabel(convo.channel_type)}
                  </span>
                </div>

                {/* Right Conversation Details */}
                <div className={styles.convoBody}>
                  <div className={styles.convoTopRow}>
                    <span className={styles.customerNameText}>{customerName}</span>
                    <span className={styles.timestampText}>
                      {formatRelativeTime(convo.last_message_at)}
                    </span>
                  </div>

                  <div className={styles.convoSnippet}>
                    {convo.subject ||
                      (convo.tags && convo.tags.length > 0
                        ? `#${convo.tags[0]} inquiry`
                        : "Active customer thread")}
                  </div>

                  <div className={styles.convoMetaRow}>
                    <div style={{ display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }}>
                      <span
                        className={`${styles.statusBadge} ${
                          convo.status === "OPEN" ? styles.statusOpen : styles.statusOther
                        }`}
                      >
                        {convo.status}
                      </span>

                      {convo.priority === "URGENT" && (
                        <span className={styles.priorityUrgent}>Urgent</span>
                      )}
                      {convo.priority === "HIGH" && (
                        <span className={styles.priorityHigh}>High</span>
                      )}

                      {convo.tags && convo.tags.length > 0 && (
                        <span className={styles.tagBadge}>#{convo.tags[0]}</span>
                      )}
                    </div>

                    {convo.unread_count > 0 && (
                      <span className={styles.unreadPill}>{convo.unread_count}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
