"use client";

import { useCallback, useState } from "react";

/**
 * Ask your shop (Owner Assistant, ADR-127): the chat state shared by the /assistant page and the floating card in the
 * dashboard shell. Both talk to the same route, `/api/v1/ai/owner-assistant/messages`; the assistant only reads.
 */

export interface AssistantTurn {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  mode: "LIVE" | "BASIC" | "REFUSED" | null;
  tools_used: string[];
  created_at: string;
}

export interface AssistantApiError {
  message: string;
  requestId?: string;
  status: number;
}

export const ASSISTANT_SUGGESTIONS = [
  "How much did I sell today?",
  "Which products sold best this week?",
  "What is low on stock?",
  "How many deliveries failed last week?",
  "আজ কত বিক্রি হলো?",
  "How much COD is still with couriers?",
];

export const ASSISTANT_MAX_CHARS = 1000;

const MESSAGES_URL = "/api/v1/ai/owner-assistant/messages";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err: AssistantApiError = { status: res.status, message: body?.error?.message ?? "Something went wrong.", requestId: body?.error?.request_id };
    throw err;
  }
  return body?.data as T;
}

const asError = (err: unknown): AssistantApiError =>
  typeof err === "object" && err && "status" in err ? (err as AssistantApiError) : { status: 0, message: "Couldn't reach CommerceOS. Check your connection." };

export const turnTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function useOwnerAssistant() {
  const [turns, setTurns] = useState<AssistantTurn[] | null>(null);
  const [loadError, setLoadError] = useState<AssistantApiError | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<AssistantApiError | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await call<{ turns: AssistantTurn[] }>(MESSAGES_URL);
      setTurns(data.turns);
      setLoadError(null);
    } catch (err) {
      setLoadError(asError(err));
    }
  }, []);

  /** Sends one question. Resolves false when it failed, so the caller can put the text back for a retry. */
  const ask = useCallback(
    async (text: string): Promise<boolean> => {
      const q = text.trim();
      if (!q || pending) return false;
      setPending(q);
      setSendError(null);
      try {
        const data = await call<{ turn: AssistantTurn }>(MESSAGES_URL, { method: "POST", body: JSON.stringify({ question: q }) });
        setTurns((t) => [...(t ?? []), data.turn]);
        return true;
      } catch (err) {
        setSendError(asError(err));
        return false;
      } finally {
        setPending(null);
      }
    },
    [pending],
  );

  const clear = useCallback(async (): Promise<boolean> => {
    setClearing(true);
    try {
      await call(MESSAGES_URL, { method: "DELETE" });
      setTurns([]);
      return true;
    } catch (err) {
      setSendError(asError(err));
      return false;
    } finally {
      setClearing(false);
    }
  }, []);

  return { turns, loadError, pending, sendError, clearing, load, ask, clear };
}
