"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageSquare,
  BarChart3,
  Globe,
  RefreshCw,
  PlusCircle,
  Filter,
} from "lucide-react";
import styles from "@/components/social/SocialInbox.module.css";
import { UnifiedInbox } from "@/components/social/UnifiedInbox";
import { ConversationThread } from "@/components/social/ConversationThread";
import { CustomerContextPanel } from "@/components/social/CustomerContextPanel";
import { SocialDashboard } from "@/components/social/SocialDashboard";
import { WebsiteChatWidget } from "@/components/social/WebsiteChatWidget";
import { ProductSearchModal } from "@/components/social/ProductSearchModal";
import { SocialOrderModal } from "@/components/social/SocialOrderModal";
import { LoadingState, EmptyState, ErrorState, PermissionDenied } from "@/components/ui/States/States";
import {
  Conversation,
  ConversationStatus,
  Message,
  CustomerIdentity,
  ConversationTag,
  Lead,
  QuickReply,
  ChannelType,
} from "@/types/social";
import { Order, Product } from "@/types/commerce";

export default function ConversationsPage() {
  const [activeTab, setActiveTab] = useState<"inbox" | "dashboard" | "simulator">("inbox");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  
  // UI states
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false); // Default minimized per user requirement

  // Filters & Search
  const [selectedChannel, setSelectedChannel] = useState<ChannelType | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Modals
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);

  // Keep conversations in ref to prevent infinite effect re-triggering loops
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;
  const loadedConvIdRef = useRef<string | null>(null);
  const isFetchingThreadRef = useRef<boolean>(false);

  // Fetch conversations list
  const loadConversations = useCallback(async () => {
    try {
      setError(null);
      let url = "/api/v1/social/conversations?";
      if (selectedChannel !== "ALL") url += `channel_type=${selectedChannel}&`;
      if (unreadOnly) url += "unread_only=true&";
      if (searchQuery.trim()) url += `search=${encodeURIComponent(searchQuery.trim())}&`;
      if (selectedTag) url += `tag=${encodeURIComponent(selectedTag)}&`;

      const res = await fetch(url);
      if (res.status === 403) {
        setPermissionError(true);
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch conversations");
      }

      const data = await res.json();
      const list: Conversation[] = data.data || data.conversations || [];
      setConversations(list);
      conversationsRef.current = list;

      // Auto-select first conversation if none selected (using functional update to decouple from selectedConversationId)
      setSelectedConversationId((prevId) => {
        if (!prevId && list.length > 0) return list[0].id;
        if (prevId && !list.some((c) => c.id === prevId)) {
          return list.length > 0 ? list[0].id : null;
        }
        return prevId;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedChannel, unreadOnly, searchQuery, selectedTag]);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load quick replies
  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch("/api/v1/social/quick-replies");
        if (res.ok) {
          const data = await res.json();
          setQuickReplies(data.data || data.quick_replies || []);
        }
      } catch {
        // Non-blocking
      }
    }
    loadTemplates();
  }, []);

  // Lock window scroll to top so fixed progressive blur does not activate over inbox
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [selectedConversationId]);

  // Fetch messages and customer context ONLY when selectedConversationId changes
  useEffect(() => {
    if (!selectedConversationId) {
      loadedConvIdRef.current = null;
      setMessages([]);
      return;
    }

    // Strictly skip if this conversation is already loaded or in-flight
    if (loadedConvIdRef.current === selectedConversationId || isFetchingThreadRef.current) {
      return;
    }
    loadedConvIdRef.current = selectedConversationId;
    isFetchingThreadRef.current = true;

    async function loadThreadDetails() {
      try {
        // Fetch messages
        const msgRes = await fetch(`/api/v1/social/conversations/${selectedConversationId}/messages`);
        if (msgRes.ok) {
          const data = await msgRes.json();
          setMessages(data.data || data.messages || []);
        }

        // Mark as read
        await fetch(`/api/v1/social/conversations/${selectedConversationId}/read`, { method: "POST" });

        // Update local unread badge ONLY if unread_count is greater than 0
        setConversations((prev) => {
          const target = prev.find((c) => c.id === selectedConversationId);
          if (!target || target.unread_count === 0) return prev;
          return prev.map((c) => (c.id === selectedConversationId ? { ...c, unread_count: 0 } : c));
        });
      } catch (err) {
        console.error("Error loading conversation context:", err);
      } finally {
        isFetchingThreadRef.current = false;
      }
    }

    loadThreadDetails();
  }, [selectedConversationId]);

  // Selected conversation object
  const activeConversation = conversations.find((c) => c.id === selectedConversationId) || null;

  // Handlers
  const handleSendMessage = async (text: string, isInternalNote: boolean) => {
    if (!selectedConversationId) return;

    if (isInternalNote) {
      const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.data?.note || data.note]);
      }
    } else {
      const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.data?.message || data.message]);
        // Refresh conversations to update preview snippet
        loadConversations();
      }
    }
  };

  const handleResolveConversation = async () => {
    if (!selectedConversationId) return;
    const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}/resolve`, {
      method: "POST",
    });
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedConversationId ? { ...c, status: "RESOLVED" } : c))
      );
    }
  };

  const handleReopenConversation = async () => {
    if (!selectedConversationId) return;
    const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}/reopen`, {
      method: "POST",
    });
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedConversationId ? { ...c, status: "OPEN" } : c))
      );
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!selectedConversationId) return;
    try {
      const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConversationId ? { ...c, status: status as ConversationStatus } : c
          )
        );
      }
    } catch (err) {
      console.error("Failed to update status", err);
    }
  };

  const handleAssignTeam = async (team: string) => {
    if (!selectedConversationId) return;
    const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_team: team }),
    });
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedConversationId ? { ...c, assigned_team: team } : c))
      );
    }
  };

  const handleAddTag = async (tag: string) => {
    if (!selectedConversationId) return;
    const res = await fetch(`/api/v1/social/conversations/${selectedConversationId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    if (res.ok) {
      const data = await res.json();
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedConversationId ? { ...c, tags: data.data?.tags || data.tags } : c))
      );
    }
  };

  const handleConvertLead = async () => {
    if (!selectedConversationId || !activeConversation) return;
    const res = await fetch("/api/v1/social/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: selectedConversationId,
        lead_score: 85,
        status: "QUALIFIED",
        buying_intent: "HIGH",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setLeads((prev) => [data.data?.lead || data.lead, ...prev]);
    }
  };

  const handleOrderCreated = (newOrder: Order) => {
    setOrders((prev) => [newOrder, ...prev]);
    setIsOrderModalOpen(false);
  };

  if (permissionError) {
    return (
      <div className={styles.inboxContainer} style={{ paddingTop: "60px" }}>
        <PermissionDenied resource="Unified Social Inbox" requiredPermission="SOCIAL_CONVERSATION_READ" />
      </div>
    );
  }

  return (
    <div className={styles.inboxContainer}>
      {/* Main Tab Views */}
      {activeTab === "dashboard" && <SocialDashboard />}

      {activeTab === "simulator" && (
        <WebsiteChatWidget
          onNewMessageSent={() => {
            loadConversations();
          }}
        />
      )}

      {activeTab === "inbox" && (
        <>
          {isLoading ? (
            <LoadingState message="Loading omnichannel conversations..." />
          ) : error ? (
            <ErrorState
              title="Failed to Load Inbox"
              message={error}
              onRetry={loadConversations}
            />
          ) : conversations.length === 0 ? (
            <EmptyState
              title="No Conversations Yet"
              description="Your omnichannel inbox is currently empty. Simulate a message or connect your channels to begin receiving customer chats."
              actionText="Open Chat Simulator"
              onAction={() => setActiveTab("simulator")}
              icon={<MessageSquare size={32} color="var(--color-primary)" />}
            />
          ) : (
            <div
              className={`${styles.threeColumnLayout} ${
                isContextPanelOpen ? styles.threeColumnLayoutExpanded : styles.threeColumnLayoutMinimized
              }`}
            >
              {/* Left Column: Conversation List across all platforms */}
              <UnifiedInbox
                conversations={conversations}
                selectedConversationId={selectedConversationId || undefined}
                onSelectConversation={(id) => setSelectedConversationId(id)}
                filterChannel={selectedChannel}
                onFilterChannelChange={(ch) => setSelectedChannel((ch as ChannelType | "ALL") || "ALL")}
                searchQuery={searchQuery}
                onSearchChange={(q) => setSearchQuery(q)}
                filterUnreadOnly={unreadOnly}
                onToggleUnreadOnly={() => setUnreadOnly(!unreadOnly)}
                filterTag={selectedTag || undefined}
                onSelectTag={(t) => setSelectedTag(t || null)}
                onRefresh={() => {
                  setIsRefreshing(true);
                  loadConversations();
                }}
                isRefreshing={isRefreshing}
              />

              {/* Middle Column: Chat Box & Composer */}
              <ConversationThread
                conversation={activeConversation}
                messages={messages}
                quickReplies={quickReplies}
                onSendMessage={handleSendMessage}
                onResolveConversation={handleResolveConversation}
                onReopenConversation={handleReopenConversation}
                onStatusChange={handleStatusChange}
                onAssignTeam={handleAssignTeam}
                isContextPanelExpanded={isContextPanelOpen}
                onToggleContextPanel={() => setIsContextPanelOpen(!isContextPanelOpen)}
              />

              {/* Right Column: Customer Profile & Commerce Context (collapsible, default minimized) */}
              {isContextPanelOpen && (
                <CustomerContextPanel
                  conversation={activeConversation}
                  onOpenOrderModal={() => setIsOrderModalOpen(true)}
                  onOpenProductModal={() => setIsProductModalOpen(true)}
                  onConvertLead={handleConvertLead}
                  onAddTag={handleAddTag}
                  onClose={() => setIsContextPanelOpen(false)}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Product Catalog Modal */}
      <ProductSearchModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        onSelectProduct={(snippet: string) => {
          setIsProductModalOpen(false);
          handleSendMessage(snippet, false);
        }}
      />

      {/* Social Order Draft Creation Modal */}
      <SocialOrderModal
        isOpen={isOrderModalOpen}
        conversation={activeConversation}
        onClose={() => setIsOrderModalOpen(false)}
        onOrderCreated={handleOrderCreated}
      />
    </div>
  );
}
