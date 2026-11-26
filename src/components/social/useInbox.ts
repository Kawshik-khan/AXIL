"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiFailure, type ApiResult } from "@/components/payments/api";
import { useDebounce } from "@/hooks/useDebounce";
import type { InboxConversation, InboxMeta, InboxQueue } from "@/domains/social/conversations/inbox-queue";
import { controlOf } from "@/domains/social/conversations/conversation-control.state";
import type { ConversationStatus, Message, QuickReply } from "@/types/social";
import type { InboxTeam } from "./inbox-view";

const PAGE = 50;
const MAX_ROWS = 200;
const MESSAGES = 50;
const MAX_MESSAGES = 500;
const REFRESH_MS = 30_000;

export interface InboxFailure extends ApiFailure {
  status: number;
}

const failureOf = (result: ApiResult<unknown>): InboxFailure => ({
  status: result.status,
  ...(result.error ?? { code: "REQUEST_FAILED", message: "The request could not be completed." }),
});

interface ListEnvelope {
  data?: InboxConversation[];
  meta?: InboxMeta;
  error?: ApiFailure;
}

type ListResult = { list: InboxConversation[]; meta: InboxMeta } | InboxFailure;

/** The list route's counts are in the envelope's `meta`, which `api()` drops. */
async function fetchList(params: URLSearchParams): Promise<ListResult> {
  params.set("view", "inbox");
  try {
    const res = await fetch(`/api/v1/social/conversations?${params}`, { credentials: "include", cache: "no-store" });
    const body = (await res.json().catch(() => null)) as ListEnvelope | null;
    if (res.ok && body?.data && body.meta) return { list: body.data, meta: body.meta };
    return { status: res.status, ...(body?.error ?? { code: "REQUEST_FAILED", message: "The inbox could not be loaded." }) };
  } catch {
    return { status: 0, code: "NETWORK_ERROR", message: "Could not reach the server. Check your connection and try again." };
  }
}

/** A message's own id, so a repeated send is the same message. */
const clientMessageId = (): string => `inbox_${Date.now()}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** The inbox's data: the list with its counts, the open chat with its messages, and everything staff can do to it. */
export function useInbox() {
  const [queue, setQueue] = useState<InboxQueue | null>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const search = useDebounce(query.trim(), 300);
  const [limit, setLimit] = useState(PAGE);

  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [meta, setMeta] = useState<InboxMeta | null>(null);
  const [listError, setListError] = useState<InboxFailure | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [active, setActive] = useState<InboxConversation | null>(null);
  const activeId = active?.id ?? null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<InboxFailure | null>(null);
  const [messageLimit, setMessageLimit] = useState(MESSAGES);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickRepliesError, setQuickRepliesError] = useState<InboxFailure | null>(null);

  /** The last action's failure, shown in the open chat. */
  const [actionError, setActionError] = useState<InboxFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const listRun = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const loadList = useCallback(async () => {
    const run = ++listRun.current;
    const params = new URLSearchParams({ queue: queue ?? "OPEN", limit: String(limit) });
    if (channel) params.set("channel_type", channel);
    if (search) params.set("search", search);
    const result = await fetchList(params);
    if (run !== listRun.current) return; // a newer filter's load is on its way
    setNow(Date.now());
    setIsLoading(false);
    setIsRefreshing(false);
    if (!("list" in result)) {
      setListError(result);
      return;
    }
    setListError(null);
    setConversations(result.list);
    setMeta(result.meta);

    const openId = activeIdRef.current;
    if (!openId) {
      setActive((prev) => prev ?? result.list[0] ?? null);
      return;
    }
    // The open chat stays open when an action moves it out of the selected queue
    let next = result.list.find((c) => c.id === openId);
    if (!next) {
      const alone = await fetchList(new URLSearchParams({ id: openId, limit: "1" }));
      if (run !== listRun.current) return;
      if ("list" in alone) next = alone.list.find((c) => c.id === openId);
    }
    const found = next;
    if (found) setActive((prev) => (prev?.id === openId ? found : prev));
  }, [queue, channel, search, limit]);

  const loadMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setIsLoadingMessages(true);
    const result = await api<Message[]>(`/api/v1/social/conversations/${encodeURIComponent(id)}/messages?limit=${messageLimit}`);
    if (activeIdRef.current !== id) return;
    setIsLoadingMessages(false);
    if (result.ok) {
      setMessages(result.data ?? []);
      setMessagesError(null);
    } else if (!quiet) {
      setMessagesError(failureOf(result));
    }
  }, [messageLimit]);

  const markRead = useCallback(async (id: string) => {
    const result = await api(`/api/v1/social/conversations/${encodeURIComponent(id)}/read`, { method: "POST" });
    if (!result.ok) return; // the badge stays: the next open tries again
    const clear = (c: InboxConversation) => (c.id === id && c.unread_count ? { ...c, unread_count: 0 } : c);
    setConversations((prev) => prev.map(clear));
    setActive((prev) => (prev ? clear(prev) : prev));
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setMessages([]);
    setMessagesError(null);
    setActionError(null);
    setNotice(null);
    setMessageLimit(MESSAGES);
  }, [activeId]);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    void api<{ quickReplies?: QuickReply[] }>("/api/v1/social/quick-replies").then((result) => {
      if (result.ok) setQuickReplies((result.data?.quickReplies ?? []).filter((r) => r.active !== false));
      else setQuickRepliesError(failureOf(result));
    });
  }, []);

  // Keeps the clocks, the list and the open chat current while the page is on screen
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setNow(Date.now());
      void loadList();
      if (activeIdRef.current) void loadMessages(activeIdRef.current, true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadList, loadMessages]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void loadList();
    if (activeIdRef.current) void loadMessages(activeIdRef.current, true);
  }, [loadList, loadMessages]);

  /** Runs one action on the open chat; the list and its counts are read again afterwards. Null when it failed. */
  const act = useCallback(
    async <T,>(name: string, path: string, json: unknown, method: "POST" | "PATCH" = "POST"): Promise<T | null> => {
      const id = activeIdRef.current;
      if (!id) return null;
      setBusy(name);
      setActionError(null);
      setNotice(null);
      const result = await api<T>(`/api/v1/social/conversations/${encodeURIComponent(id)}${path}`, { method, ...(json === undefined ? {} : { json }) });
      setBusy(null);
      if (!result.ok) {
        if (activeIdRef.current === id) setActionError(failureOf(result));
        return null;
      }
      void loadList();
      return result.data ?? ({} as T);
    },
    [loadList]
  );

  /** True when the server stored it; the message's own status says whether it reached the customer. */
  const send = async (text: string, isNote: boolean): Promise<boolean> => {
    const id = activeIdRef.current;
    const data = isNote
      ? await act<{ message?: Message }>("send", "/notes", { text })
      : await act<{ message?: Message }>("send", "/messages", { text, client_message_id: clientMessageId() });
    if (!data) return false;
    const { message } = data;
    if (message && activeIdRef.current === id) setMessages((prev) => [...prev.filter((m) => m.id !== message.id), message]);
    return true;
  };

  const assign = (userId: string | undefined, team: InboxTeam | undefined) => act("assign", "/assign", { assigned_user_id: userId, assigned_team_id: team });

  const takeOver = async () => {
    if (!active || !meta) return;
    const held = controlOf(active).state === "HUMAN";
    if (!held && !(await act("control", "", { automation_paused: true }, "PATCH"))) return;
    // A colleague's chat, or one assigned to them: the assignment is what names its owner
    if (held || (active.assigned_user_id && active.assigned_user_id !== meta.viewer_id)) await assign(meta.viewer_id, active.assigned_team_id);
  };

  const saveLead = async () => {
    if (!active?.customer) return;
    const { id } = active;
    setBusy("lead");
    setActionError(null);
    setNotice(null);
    const result = await api("/api/v1/social/leads", {
      method: "POST",
      json: { customer_id: active.customer.id, conversation_id: active.id, source: active.source },
    });
    setBusy(null);
    if (activeIdRef.current !== id) return; // its outcome belongs to that chat
    if (result.ok) setNotice("Saved as a new lead.");
    else setActionError(failureOf(result));
  };

  return {
    queue, channel, query, limit, conversations, meta, listError, isLoading, isRefreshing, now,
    active, messages, isLoadingMessages, messagesError, quickReplies, quickRepliesError, actionError, notice, busy,
    /** More chats match than the list can show: say so, and how to find them. */
    isCutOff: Boolean(meta && meta.total > conversations.length && limit >= MAX_ROWS),
    canLoadEarlier: messages.length >= messageLimit && messageLimit < MAX_MESSAGES,
    loadEarlier: () => setMessageLimit((n) => Math.min(MAX_MESSAGES, n + 150)),
    canLoadMore: Boolean(meta && meta.total > conversations.length && limit < MAX_ROWS),
    setQuery,
    setQueue: (next: InboxQueue | null) => { setQueue(next); setLimit(PAGE); },
    setChannel: (next: string | null) => { setChannel(next); setLimit(PAGE); },
    clearFilters: () => { setQueue(null); setChannel(null); setQuery(""); setLimit(PAGE); },
    loadMore: () => setLimit((n) => Math.min(MAX_ROWS, n + PAGE)),
    open: setActive,
    refresh,
    retryMessages: () => { if (activeId) void loadMessages(activeId); },
    dismissError: () => setActionError(null),
    showError: setActionError,
    showNotice: setNotice,
    markRead, send, takeOver, assign, saveLead,
    giveToAgent: () => act("control", "", { automation_paused: false, status: "OPEN" }, "PATCH"),
    resolve: () => act("resolve", "/resolve", undefined),
    reopen: () => act("resolve", "/reopen", undefined),
    setStatus: (status: ConversationStatus) => act("status", "", { status }, "PATCH"),
    addTag: (tag: string) => act("tag", "/tags", { tag }),
  };
}

export type Inbox = ReturnType<typeof useInbox>;
