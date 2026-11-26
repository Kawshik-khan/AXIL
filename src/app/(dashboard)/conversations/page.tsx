"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { EMPTY_DRAFT, type Draft } from "@/components/social/Composer";
import { UnifiedInbox } from "@/components/social/UnifiedInbox";
import { ConversationThread } from "@/components/social/ConversationThread";
import { CustomerContextPanel } from "@/components/social/CustomerContextPanel";
import { draftOrderOf } from "@/components/social/HandoffContextCard";
import { QueueTiles } from "@/components/social/QueueTiles";
import { SocialDashboard } from "@/components/social/SocialDashboard";
import { WebsiteChatWidget } from "@/components/social/WebsiteChatWidget";
import { ProductSearchModal } from "@/components/social/ProductSearchModal";
import { SocialOrderModal } from "@/components/social/SocialOrderModal";
import { useInbox } from "@/components/social/useInbox";
import { EmptyState, PermissionDenied } from "@/components/ui/States/States";
import type { InboxConversation, InboxOrderDraft } from "@/domains/social/conversations/inbox-queue";
import styles from "@/components/social/Inbox.module.css";

type View = "conversations" | "performance" | "test";

const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: "conversations", label: "Conversations" },
  { value: "performance", label: "Performance" },
  { value: "test", label: "Test chat" },
];

const PHONE = "(max-width: 768px)";
/** Above this width the customer rail has its own column and is open until closed. */
const WIDE = "(min-width: 1241px)";

export default function ConversationsPage() {
  const router = useRouter();
  const inbox = useInbox();
  const [view, setView] = useState<View>("conversations");
  /** On a phone the list and the chat are separate screens; wider screens show both. */
  const [chatOpen, setChatOpen] = useState(false);
  const [rail, setRail] = useState<"auto" | "open" | "closed">("auto");
  const [isWide, setIsWide] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  /** What was opened is what is confirmed: a refresh of the list never changes an open form. */
  const [orderModal, setOrderModal] = useState<{ conversation: InboxConversation; draft?: InboxOrderDraft; ticketId?: string } | null>(null);

  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const phone = window.matchMedia(PHONE);
    const read = () => {
      setIsWide(wide.matches);
      setIsPhone(phone.matches);
    };
    read();
    wide.addEventListener("change", read);
    phone.addEventListener("change", read);
    return () => {
      wide.removeEventListener("change", read);
      phone.removeEventListener("change", read);
    };
  }, []);

  // A chat that is on screen is read, also when a message arrives while it is open. On a phone the list comes first.
  const { active, markRead } = inbox;
  const activeId = active?.id;
  const unread = active?.unread_count ?? 0;
  const isOnScreen = view === "conversations" && (isPhone ? chatOpen : true);
  useEffect(() => {
    if (activeId && unread > 0 && isOnScreen) void markRead(activeId);
  }, [activeId, unread, isOnScreen, markRead]);

  // The page under a full-screen chat doesn't scroll
  const isFullScreen = isPhone && chatOpen && view === "conversations" && Boolean(active);
  useEffect(() => {
    if (!isFullScreen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isFullScreen]);

  if (inbox.listError?.status === 403) {
    return <PermissionDenied resource="the inbox" requiredPermission="social.conversation.read" />;
  }

  const open = (c: InboxConversation) => {
    inbox.open(c);
    setChatOpen(true);
    if (!isWide) setRail("auto");
  };
  const railOpen = rail === "open" || (rail === "auto" && isWide);
  const draft = (activeId && drafts[activeId]) || EMPTY_DRAFT;
  const setDraft = (conversationId: string, next: Draft) => setDrafts((prev) => ({ ...prev, [conversationId]: next }));

  const queues = inbox.meta?.queues;
  const hasNoChats = Boolean(queues && queues.NEEDS_PERSON + queues.AGENT + queues.TEAM + queues.DONE === 0);

  return (
    <div className={`${styles.inbox} ${view === "conversations" ? "" : styles.inboxPage}`}>
      <div className={styles.head}>
        <div className={styles.titleBox}>
          <h1 className={styles.title}>Inbox</h1>
          <div className={styles.views} role="group" aria-label="Inbox views">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => setView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>
        {view === "conversations" && <QueueTiles meta={inbox.meta} selected={inbox.queue} now={inbox.now} onSelect={inbox.setQueue} />}
      </div>

      {view === "performance" && <SocialDashboard />}
      {view === "test" && <WebsiteChatWidget onNewMessageSent={inbox.refresh} />}

      {view === "conversations" &&
        (hasNoChats ? (
          <div className={`${styles.card} ${styles.fill}`}>
            <EmptyState
              inline
              title="No conversations yet"
              description="Connect a channel and customer chats arrive here, or send yourself a message with Test chat."
              actionText="Connect a channel"
              onAction={() => router.push("/connector")}
              icon={<MessageSquare size={28} />}
            />
          </div>
        ) : (
          <div className={styles.workspace} data-rail={active ? rail : "closed"}>
            <UnifiedInbox inbox={inbox} onOpen={open} />
            <ConversationThread
              inbox={inbox}
              isOpen={chatOpen && Boolean(active)}
              onBack={() => {
                setChatOpen(false);
                setRail("auto");
              }}
              onToggleRail={() => setRail(railOpen ? "closed" : "open")}
              railOpen={railOpen}
              draft={draft}
              onDraft={setDraft}
              onOpenProducts={() => setIsProductModalOpen(true)}
            />
            {railOpen && active && (
              <CustomerContextPanel
                inbox={inbox}
                onClose={() => setRail("closed")}
                onCreateOrder={() => setOrderModal({ conversation: active })}
                onReviewDraft={() => setOrderModal({ conversation: active, ...draftOrderOf(active) })}
              />
            )}
          </div>
        ))}

      <ProductSearchModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        onSelectProduct={(snippet) => {
          // Into the reply box, for staff to read before it is sent
          if (activeId) setDraft(activeId, { ...draft, text: draft.text.trim() ? `${draft.text}\n${snippet}` : snippet });
          setIsProductModalOpen(false);
        }}
      />

      <SocialOrderModal
        isOpen={orderModal !== null}
        conversation={orderModal?.conversation ?? null}
        draft={orderModal?.draft}
        draftTicketId={orderModal?.ticketId}
        onClose={() => setOrderModal(null)}
        onOrderCreated={(order) => {
          setOrderModal(null);
          inbox.showNotice(`Order ${order.order_number} created.`);
          inbox.refresh();
        }}
      />
    </div>
  );
}
