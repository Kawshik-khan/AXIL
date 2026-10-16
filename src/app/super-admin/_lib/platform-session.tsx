"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/** What GET /api/v1/platform/auth/session returns. Nothing here has a client-side default (plan R2). */
export interface PlatformOperator {
  id: string;
  email: string;
  name?: string;
  status?: string;
}

export interface PlatformSession {
  user: PlatformOperator;
  role: string;
  permissions: string[];
  mfaVerified: boolean;
  stepUpVerified: boolean;
  scope: string;
}

interface StepUpGrant {
  token: string;
  expiresAt: number;
}

interface PlatformSessionValue {
  session: PlatformSession;
  can: (permission: string) => boolean;
  /** The step-up token, held in memory only (never storage) until it expires or a CRITICAL action consumes it. */
  stepUp: StepUpGrant | null;
  grantStepUp: (token: string, expiresInSec: number) => void;
  clearStepUp: () => void;
}

const PlatformSessionContext = createContext<PlatformSessionValue | null>(null);

export const PlatformSessionProvider: React.FC<{ session: PlatformSession; children: React.ReactNode }> = ({
  session,
  children,
}) => {
  const [stepUp, setStepUp] = useState<StepUpGrant | null>(null);
  const timer = useRef<number | null>(null);

  const clearStepUp = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setStepUp(null);
  }, []);

  const grantStepUp = useCallback((token: string, expiresInSec: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const ms = Math.max(0, expiresInSec * 1000);
    setStepUp({ token, expiresAt: Date.now() + ms });
    timer.current = window.setTimeout(() => setStepUp(null), ms);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const value = useMemo<PlatformSessionValue>(
    () => ({
      session,
      can: (permission: string) => session.permissions.includes(permission),
      stepUp,
      grantStepUp,
      clearStepUp,
    }),
    [session, stepUp, grantStepUp, clearStepUp]
  );

  return <PlatformSessionContext.Provider value={value}>{children}</PlatformSessionContext.Provider>;
};

export function usePlatformSession(): PlatformSessionValue {
  const value = useContext(PlatformSessionContext);
  if (!value) throw new Error("usePlatformSession must be used inside the platform console layout.");
  return value;
}

/** Validates the session payload; returns null when a required field is missing (the shell then shows an error). */
export function parsePlatformSession(data: unknown): PlatformSession | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const user = d.user as Record<string, unknown> | undefined;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") return null;
  if (typeof d.role !== "string" || !Array.isArray(d.permissions)) return null;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: typeof user.name === "string" ? user.name : undefined,
      status: typeof user.status === "string" ? user.status : undefined,
    },
    role: d.role,
    permissions: d.permissions.filter((p): p is string => typeof p === "string"),
    mfaVerified: d.mfaVerified === true,
    stepUpVerified: d.stepUpVerified === true,
    scope: typeof d.scope === "string" ? d.scope : "",
  };
}
