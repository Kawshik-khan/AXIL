"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlatformApiError, PlatformSessionExpiredError, platformRequest } from "./platform-client";

export type ResourceState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T; meta?: Record<string, unknown>; fetchedAt: string }
  | { kind: "empty"; meta?: Record<string, unknown>; fetchedAt: string }
  | { kind: "error"; message: string; requestId?: string; status: number }
  | { kind: "forbidden"; permission?: string };

export interface ResourceOptions<T> {
  /** When true for a successful response, the view shows its empty state instead of the data. */
  isEmpty?: (data: T) => boolean;
  /** Poll while the tab is visible (Control Tower only); off by default. */
  refreshMs?: number;
}

/**
 * Loads one platform GET route into the six console states (plan §5.1). A 401 is handled by platformFetch
 * (redirect to sign-in); a 403 becomes `forbidden` with the permission the API names; every other failure keeps
 * the request id so the operator can quote it. `url = null` skips the request (e.g. a missing id).
 */
export function usePlatformResource<T>(url: string | null, options: ResourceOptions<T> = {}) {
  const [state, setState] = useState<ResourceState<T>>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);
  const isEmptyRef = useRef(options.isEmpty);
  isEmptyRef.current = options.isEmpty;
  const hasDataRef = useRef(false);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // Keep showing the last data during a refresh; only a first load shows the skeleton
    if (!hasDataRef.current) setState({ kind: "loading" });

    platformRequest<T>(url)
      .then((envelope) => {
        if (cancelled) return;
        const fetchedAt = envelope.meta?.timestamp || new Date().toISOString();
        const empty = envelope.data === null || envelope.data === undefined || Boolean(isEmptyRef.current?.(envelope.data));
        hasDataRef.current = true;
        setState(
          empty
            ? { kind: "empty", meta: envelope.meta, fetchedAt }
            : { kind: "ready", data: envelope.data, meta: envelope.meta, fetchedAt }
        );
      })
      .catch((err: unknown) => {
        if (cancelled || err instanceof PlatformSessionExpiredError) return;
        hasDataRef.current = false;
        if (err instanceof PlatformApiError && err.status === 403) {
          const permission = typeof err.details?.permission === "string" ? err.details.permission : undefined;
          setState({ kind: "forbidden", permission });
          return;
        }
        if (err instanceof PlatformApiError) {
          setState({ kind: "error", message: err.message, requestId: err.requestId, status: err.status });
          return;
        }
        setState({ kind: "error", message: "The platform API could not be reached.", status: 0 });
      });

    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  useEffect(() => {
    if (!url || !options.refreshMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, options.refreshMs);
    return () => window.clearInterval(id);
  }, [url, options.refreshMs, reload]);

  return { state, reload };
}
