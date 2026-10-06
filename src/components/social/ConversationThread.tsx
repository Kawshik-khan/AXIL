"use client";

import { AiModeBadge } from "@/components/ai/AiModeBadge";
import React, { useState, useEffect, useRef } from "react";
import {
  Send,
  Lock,
  MessageSquare,
  Check,
  CheckCheck,
  Zap,
  Tag,
  UserCheck,
  CheckCircle,
  RotateCcw,
  Sparkles,
  User,
  PanelRightOpen,
  ChevronDown,
  Users,
} from "lucide-react";
import { Message, Conversation, QuickReply } from "@/types/social";
import { Button } from "@/components/ui/Button/Button";
import styles from "./SocialInbox.module.css";
import { HandoffContextCard, isHandoffCard } from "./HandoffContextCard";
import { ShadowDraftCard, isShadowDraft } from "./ShadowDraftCard";

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open", color: "#10B981" },
  { value: "WAITING_CUSTOMER", label: "Waiting Customer", color: "#F59E0B" },
  { value: "WAITING_AGENT", label: "Waiting Agent", color: "#3B82F6" },
  { value: "RESOLVED", label: "Resolved", color: "#6B7280" },
  { value: "CLOSED", label: "Closed", color: "#9CA3AF" },
];

const TEAM_OPTIONS = [
  { value: "SALES", label: "Sales Team" },
  { value: "SUPPORT", label: "Support Team" },
  { value: "ORDERS", label: "Orders Team" },
  { value: "RETURNS", label: "Returns Team" },
  { value: "FINANCE", label: "Finance Team" },
  { value: "GENERAL", label: "General" },
];

interface ConversationThreadProps {
  conversation: any;
  messages: Message[];
  quickReplies: QuickReply[];
  onSendMessage: (text: string, isInternalNote: boolean) => Promise<void>;
  onResolveConversation: () => Promise<void>;
  onReopenConversation: () => Promise<void>;
  onStatusChange: (status: string) => Promise<void>;
  onAssignTeam: (team: string) => Promise<void>;
  isLoadingMessages?: boolean;
  isContextPanelExpanded?: boolean;
  onToggleContextPanel?: () => void;
}

export const ConversationThread: React.FC<ConversationThreadProps> = ({
  conversation,
  messages,
  quickReplies,
  onSendMessage,
  onResolveConversation,
  onReopenConversation,
  onStatusChange,
  onAssignTeam,
  isLoadingMessages,
  isContextPanelExpanded,
  onToggleContextPanel,
}) => {
  const [inputText, setInputText] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [copilotSuggestion, setCopilotSuggestion] = useState<any | null>(null);
  const [isLoadingCopilot, setIsLoadingCopilot] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const teamDropdownRef = useRef<HTMLDivElement>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setIsStatusDropdownOpen(false);
      }
      if (teamDropdownRef.current && !teamDropdownRef.current.contains(e.target as Node)) {
        setIsTeamDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleGetCopilotSuggestion = async () => {
    if (!conversation?.id) return;
    try {
      setIsLoadingCopilot(true);
      const res = await fetch("/api/v1/ai/copilot/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversation.id }),
      });
      if (res.ok) {
        const d = await res.json();
        setCopilotSuggestion(d.data);
      }
    } catch (err) {
      console.error("Copilot suggestion failed", err);
    } finally {
      setIsLoadingCopilot(false);
    }
  };

  useEffect(() => {
    if (streamContainerRef.current) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return;
    try {
      setIsSending(true);
      await onSendMessage(inputText.trim(), isInternalNote);
      setInputText("");
      setIsInternalNote(false);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectQuickReply = (qr: QuickReply) => {
    setInputText(qr.content);
    setShowQuickReplies(false);
  };

  if (!conversation) {
    return (
      <div className={styles.threadPanel} style={{ alignItems: "center", justifyContent: "center" }}>
        <MessageSquare size={36} color="var(--color-text-muted)" style={{ opacity: 0.4, marginBottom: "12px" }} />
        <h3 style={{ fontSize: "1rem", color: "var(--color-text-primary)" }}>Select a conversation</h3>
        <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Choose a conversation from the left to view customer messages and reply.
        </p>
      </div>
    );
  }

  const customerName = conversation.customer
    ? `${conversation.customer.first_name} ${conversation.customer.last_name}`
    : `Customer (${conversation.external_conversation_id.slice(-6)})`;

  return (
    <div className={styles.threadPanel}>
      {/* Header */}
      <div className={styles.threadHeader}>
        <div className={styles.threadCustomerInfo}>
          <div className={styles.customerAvatar}>
            {customerName.charAt(0)}
          </div>
          <div className={styles.customerMeta}>
            <div className={styles.customerMetaName}>
              {customerName}
            </div>
            <div className={styles.customerMetaChannel}>
              <span>via {conversation.channel_type}</span>
              <span>•</span>
              <span>ID: {conversation.external_conversation_id.slice(-8)}</span>
            </div>
          </div>
        </div>

        {/* Status and Action Buttons */}
        <div className={styles.threadHeaderActions}>
          {/* Custom Status Dropdown */}
          <div className={styles.customDropdown} ref={statusDropdownRef}>
            <button
              type="button"
              className={`${styles.dropdownTrigger} ${isStatusDropdownOpen ? styles.dropdownTriggerActive : ""}`}
              onClick={() => {
                setIsStatusDropdownOpen(!isStatusDropdownOpen);
                setIsTeamDropdownOpen(false);
              }}
              title="Change Conversation Status"
            >
              <span
                className={styles.statusDot}
                style={{
                  background:
                    STATUS_OPTIONS.find((s) => s.value === conversation.status)?.color || "#10B981",
                  boxShadow: `0 0 0 2px ${
                    (STATUS_OPTIONS.find((s) => s.value === conversation.status)?.color || "#10B981") + "33"
                  }`,
                }}
              />
              <span className={styles.dropdownTriggerLabel}>
                {STATUS_OPTIONS.find((s) => s.value === conversation.status)?.label || "Open"}
              </span>
              <ChevronDown
                size={13}
                className={`${styles.dropdownChevron} ${isStatusDropdownOpen ? styles.dropdownChevronOpen : ""}`}
              />
            </button>

            {isStatusDropdownOpen && (
              <div className={styles.dropdownMenu}>
                <div className={styles.dropdownMenuHeader}>STATUS</div>
                {STATUS_OPTIONS.map((opt) => {
                  const isSelected = conversation.status === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemActive : ""}`}
                      onClick={() => {
                        onStatusChange(opt.value);
                        setIsStatusDropdownOpen(false);
                      }}
                    >
                      <div className={styles.dropdownItemLeft}>
                        <span
                          className={styles.dropdownItemDot}
                          style={{ background: opt.color }}
                        />
                        <span>{opt.label}</span>
                      </div>
                      {isSelected && <Check size={14} color="#059669" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Custom Team Assignment Dropdown */}
          <div className={styles.customDropdown} ref={teamDropdownRef}>
            <button
              type="button"
              className={`${styles.dropdownTrigger} ${isTeamDropdownOpen ? styles.dropdownTriggerActive : ""}`}
              onClick={() => {
                setIsTeamDropdownOpen(!isTeamDropdownOpen);
                setIsStatusDropdownOpen(false);
              }}
              title="Assign Team"
            >
              <Users size={13} color="#6B7280" />
              <span className={styles.dropdownTriggerLabel}>
                {TEAM_OPTIONS.find((t) => t.value === (conversation.assigned_team_id || "SUPPORT"))?.label || "Support Team"}
              </span>
              <ChevronDown
                size={13}
                className={`${styles.dropdownChevron} ${isTeamDropdownOpen ? styles.dropdownChevronOpen : ""}`}
              />
            </button>

            {isTeamDropdownOpen && (
              <div className={styles.dropdownMenu}>
                <div className={styles.dropdownMenuHeader}>ASSIGN TEAM</div>
                {TEAM_OPTIONS.map((opt) => {
                  const isSelected = (conversation.assigned_team_id || "SUPPORT") === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemActive : ""}`}
                      onClick={() => {
                        onAssignTeam(opt.value);
                        setIsTeamDropdownOpen(false);
                      }}
                    >
                      <div className={styles.dropdownItemLeft}>
                        <span>{opt.label}</span>
                      </div>
                      {isSelected && <Check size={14} color="#059669" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {conversation.status === "RESOLVED" || conversation.status === "CLOSED" ? (
            <Button size="sm" variant="outline" onClick={onReopenConversation}>
              <RotateCcw size={14} style={{ marginRight: "4px" }} /> Reopen
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onResolveConversation}>
              <CheckCircle size={14} style={{ marginRight: "4px" }} /> Resolve
            </Button>
          )}

          {onToggleContextPanel && (
            <button
              type="button"
              className={`${styles.contextToggleBtn} ${
                isContextPanelExpanded ? styles.contextToggleBtnActive : ""
              }`}
              onClick={onToggleContextPanel}
              title={
                isContextPanelExpanded
                  ? "Minimize customer details"
                  : "Expand customer details"
              }
            >
              <User size={13} />
              <span>{isContextPanelExpanded ? "Hide Details" : "Customer Details"}</span>
              <PanelRightOpen
                size={13}
                style={{
                  transform: isContextPanelExpanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s ease",
                }}
              />
            </button>
          )}
        </div>
      </div>

      {/* Message Stream */}
      <div ref={streamContainerRef} className={styles.messageStream}>
        {conversation.automation_paused && isHandoffCard(conversation.metadata?.handoff_card) && (
          <HandoffContextCard card={conversation.metadata.handoff_card} />
        )}
        {isLoadingMessages && (
          <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>
            Loading message stream...
          </div>
        )}

        {messages.map((msg) => {
          const isNote = msg.message_type === "INTERNAL_NOTE";
          const isInbound = msg.direction === "INBOUND";
          const isAi = msg.sender_type === "BOT" || Boolean(msg.metadata?.is_ai);

          if (isNote) {
            return (
              <div key={msg.id} className={styles.internalNoteRow}>
                <div className={styles.internalNoteBubble}>
                  <div className={styles.internalNoteHeader}>
                    <Lock size={12} />
                    <span>INTERNAL NOTE • {String(msg.metadata?.author_name || "Operator")}</span>
                  </div>
                  <div>{msg.text}</div>
                  <div style={{ fontSize: "0.6875rem", color: "#B45309", textAlign: "right", marginTop: "4px" }}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`${styles.messageBubbleRow} ${isInbound ? styles.inboundRow : styles.outboundRow}`}
            >
              <div
                className={`${styles.bubble} ${
                  isInbound
                    ? styles.inboundBubble
                    : isAi
                    ? styles.aiBubble
                    : styles.outboundBubble
                }`}
              >
                {isAi && (
                  <div className={styles.aiBadgeRow}>
                    <span className={styles.aiBadgePill}>
                      <Sparkles size={11} color="#121316" />
                      AI Copilot
                    </span>
                    {Boolean(msg.metadata?.confidence) && (
                      <span className={styles.aiConfidence}>
                        {Math.round(Number(msg.metadata.confidence) * 100)}% Match
                      </span>
                    )}
                  </div>
                )}
                <div>{msg.text}</div>
                {Boolean(msg.metadata?.policy_citation) && (
                  <div className={styles.aiCitationPill}>
                    📚 {String(msg.metadata.policy_citation)}
                  </div>
                )}
              </div>
              <div className={styles.bubbleMeta}>
                <span>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {!isInbound && (
                  <span>
                    {msg.status === "READ" ? (
                      <CheckCheck size={14} color="#10B981" />
                    ) : msg.status === "DELIVERED" ? (
                      <CheckCheck size={14} color="#9CA3AF" />
                    ) : msg.status === "SENT" ? (
                      <Check size={14} color="#9CA3AF" />
                    ) : msg.status === "FAILED" ? (
                      <span style={{ color: "var(--color-danger)" }} title={msg.failure_reason}>
                        {msg.failure_reason?.includes("INTEGRATION_NOT_CONFIGURED") || msg.failure_reason?.includes("is not connected")
                          ? "Not delivered: channel sending isn't connected"
                          : "Not delivered"}
                      </span>
                    ) : (
                      <span>Sending...</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {isShadowDraft(conversation.metadata?.agent_shadow_reply) && (
          <ShadowDraftCard key={conversation.metadata.agent_shadow_reply.run_id} conversationId={conversation.id} draft={conversation.metadata.agent_shadow_reply} />
        )}
      </div>

      {/* Composer Area */}
      <div className={styles.composerArea}>
        <div className={styles.composerToolbar}>
          <div className={styles.toolbarLeft}>
            {/* Mode Switch: Customer reply vs Internal Note */}
            <button
              type="button"
              className={`${styles.filterBadge} ${!isInternalNote ? styles.filterBadgeActive : ""}`}
              onClick={() => setIsInternalNote(false)}
            >
              Customer Reply
            </button>
            <button
              type="button"
              className={`${styles.filterBadge} ${isInternalNote ? styles.filterBadgeActive : ""}`}
              onClick={() => setIsInternalNote(true)}
              style={
                isInternalNote
                  ? { background: "#FEF3C7", borderColor: "#F59E0B", color: "#92400E", fontWeight: 700 }
                  : {}
              }
            >
              <Lock size={12} style={{ marginRight: "4px" }} /> Internal Note
            </button>

            {/* Quick Replies Dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className={styles.filterBadge}
                onClick={() => setShowQuickReplies(!showQuickReplies)}
              >
                <Zap size={12} style={{ marginRight: "4px" }} /> Quick Replies
              </button>

              {showQuickReplies && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: 0,
                    marginBottom: "8px",
                    background: "#FFFFFF",
                    border: "1px solid rgba(0, 0, 0, 0.1)",
                    borderRadius: "12px",
                    padding: "8px",
                    width: "300px",
                    maxHeight: "240px",
                    overflowY: "auto",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
                    zIndex: 100,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      color: "#6B7280",
                      padding: "4px 8px",
                      marginBottom: "4px",
                    }}
                  >
                    SAVED RESPONSES
                  </div>
                  {quickReplies.length === 0 ? (
                    <div style={{ fontSize: "0.75rem", color: "#6B7280", padding: "8px" }}>
                      No quick replies found.
                    </div>
                  ) : (
                    quickReplies.map((qr) => (
                      <div
                        key={qr.id}
                        onClick={() => handleSelectQuickReply(qr)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "8px",
                          cursor: "pointer",
                          fontSize: "0.8125rem",
                          transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F4F6")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ fontWeight: 600, color: "#1F2937" }}>{qr.title}</div>
                        <div
                          style={{
                            fontSize: "0.6875rem",
                            color: "#6B7280",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginTop: "2px",
                          }}
                        >
                          {qr.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* AI Copilot Suggest Button */}
            <button
              type="button"
              className={styles.filterBadge}
              onClick={handleGetCopilotSuggestion}
              disabled={isLoadingCopilot}
              style={{
                background: "rgba(199, 249, 0, 0.2)",
                borderColor: "rgba(199, 249, 0, 0.5)",
                color: "#121316",
                fontWeight: 700,
              }}
            >
              <Sparkles size={12} style={{ marginRight: "4px" }} />
              {isLoadingCopilot ? "Thinking..." : "✦ AI Suggest"}
            </button>
            <AiModeBadge />
          </div>

          <div style={{ fontSize: "0.6875rem", color: "#6B7280" }}>
            {isInternalNote ? "Note visible only to operators" : "Press Cmd+Enter to send"}
          </div>
        </div>

        {/* AI Copilot Suggestion Banner */}
        {copilotSuggestion && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "12px",
              background: "#FAFDE6",
              border: "1.5px solid #C7F900",
              boxShadow: "0 4px 14px rgba(199, 249, 0, 0.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "6px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "#121316",
                }}
              >
                <Sparkles size={14} color="#059669" />
                <span>
                  AI COPILOT DRAFT ({copilotSuggestion.intent}
                  {typeof copilotSuggestion.confidence === "number"
                    ? ` • ${(copilotSuggestion.confidence * 100).toFixed(0)}% confidence`
                    : ""}
                  )
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCopilotSuggestion(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6B7280",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: "0.875rem", color: "#1F2937", lineHeight: 1.5, marginBottom: "10px" }}>
              {copilotSuggestion.suggested_reply}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => {
                  setInputText(copilotSuggestion.suggested_reply);
                  setCopilotSuggestion(null);
                }}
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  padding: "6px 14px",
                  borderRadius: "8px",
                  background: "#C7F900",
                  color: "#121316",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 2px 6px rgba(199, 249, 0, 0.35)",
                }}
              >
                Use Suggestion
              </button>
              <button
                type="button"
                onClick={() => {
                  onSendMessage(copilotSuggestion.suggested_reply, false);
                  setCopilotSuggestion(null);
                }}
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  padding: "6px 14px",
                  borderRadius: "8px",
                  background: "#242529",
                  color: "#FFFFFF",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Send Directly
              </button>
            </div>
          </div>
        )}

        {/* Input & Send Button */}
        <div className={styles.composerInputRow}>
          <textarea
            className={`${styles.composerTextarea} ${
              isInternalNote ? styles.internalNoteActiveTextarea : ""
            }`}
            placeholder={
              isInternalNote
                ? "Write an internal team note (never sent to customer)..."
                : "Type your reply in Bangla, English, or Banglish..."
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            title="Send reply (Cmd+Enter)"
          >
            {isSending ? "Sending..." : isInternalNote ? "Add Note" : (
              <>
                <span>Send</span>
                <Send size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
