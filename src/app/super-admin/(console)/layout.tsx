"use client";

import React, { useCallback, useEffect, useState } from "react";
import shell from "@/components/navigation/Shell.module.css";
import { ErrorState, LoadingSkeleton } from "@/components/ui/States/States";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import {
  PLATFORM_LOGIN_PATH,
  PlatformApiError,
  PlatformSessionExpiredError,
  platformFetch,
  platformRequest,
} from "../_lib/platform-client";
import { PlatformSessionProvider, parsePlatformSession, type PlatformSession } from "../_lib/platform-session";
import { PlatformTopBar } from "../_components/PlatformTopBar";
import { ConsoleSidebarBoundary } from "../_components/ConsoleSidebar";
import consoleStyles from "../super-admin.module.css";
import { ConsoleThemeProvider } from "../_lib/console-theme";
import { PlatformCommandPalette } from "../_components/PlatformCommandPalette";
import { ConsoleBanners } from "../_components/ConsoleBanners";
import { AuthenticatorSetupDialog } from "../_components/AuthenticatorSetupDialog";
import { Button } from "@/components/ui/Button/Button";
import { usePendingApprovals } from "../_lib/use-pending-approvals";
import { useAttentionSummary } from "../_lib/use-attention-summary";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; session: PlatformSession }
  | { kind: "error"; message: string; requestId?: string };

/** The platform console shell: a sidebar, a top bar and the page on a flat grey canvas, in the console's own palette and
 *  light / dark theme (console-theme.tsx, tokens.css --console-*). */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleThemeProvider>
      <ConsoleLoader>{children}</ConsoleLoader>
    </ConsoleThemeProvider>
  );
}

function ConsoleLoader({ children }: { children: React.ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    platformRequest<unknown>("/api/v1/platform/auth/session")
      .then((res) => {
        if (cancelled) return;
        const session = parsePlatformSession(res.data);
        setLoad(
          session
            ? { kind: "ready", session }
            : { kind: "error", message: "The platform session response is missing the operator identity or role." }
        );
      })
      .catch((err: unknown) => {
        if (cancelled || err instanceof PlatformSessionExpiredError) return;
        if (err instanceof PlatformApiError) setLoad({ kind: "error", message: err.message, requestId: err.requestId });
        else setLoad({ kind: "error", message: "The platform API could not be reached." });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (load.kind === "loading") {
    return (
      <div className={shell.shell}>
        <div className={shell.mainWrapper}>
          <main className={shell.mainContent}>
            <LoadingSkeleton lines={4} height="200px" />
          </main>
        </div>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div className={shell.shell}>
        <div className={shell.mainWrapper}>
          <main className={shell.mainContent}>
            <ErrorState
              title="The console could not start"
              message={load.message}
              requestId={load.requestId}
              onRetry={() => setNonce((n) => n + 1)}
            />
          </main>
        </div>
      </div>
    );
  }

  return (
    <PlatformSessionProvider session={load.session}>
      <ConsoleFrame session={load.session}>{children}</ConsoleFrame>
    </PlatformSessionProvider>
  );
}

function ConsoleFrame({ session, children }: { session: PlatformSession; children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authenticatorOpen, setAuthenticatorOpen] = useState(false);
  // From the session; turned on locally once setup succeeds in this tab
  const [mfaEnrolled, setMfaEnrolled] = useState(session.mfaEnrolled);
  const canReadPlatform = session.permissions.includes(PLATFORM_PERMISSIONS.PLATFORM_READ);
  const pendingApprovals = usePendingApprovals(canReadPlatform);
  const attention = useAttentionSummary(canReadPlatform);
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = useCallback(() => setNavOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/v1/platform/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    window.location.assign(PLATFORM_LOGIN_PATH);
  }, []);

  const signOutEverywhere = useCallback(async () => {
    await platformFetch("/api/v1/platform/auth/sessions/revoke-all", { method: "POST" }).catch(() => undefined);
    window.location.assign(PLATFORM_LOGIN_PATH);
  }, []);

  return (
    <div className={consoleStyles.consoleShell}>
      <ConsoleSidebarBoundary
        items={attention}
        drawerOpen={navOpen}
        onCloseDrawer={closeNav}
        mfaEnrolled={mfaEnrolled}
        onSetUpAuthenticator={() => setAuthenticatorOpen(true)}
        onSignOut={signOut}
        onSignOutEverywhere={signOutEverywhere}
      />
      <div className={consoleStyles.consoleMain}>
        <PlatformTopBar
          onOpenCommandPalette={() => setPaletteOpen(true)}
          onOpenNavigation={() => setNavOpen(true)}
          navigationOpen={navOpen}
          pendingApprovals={pendingApprovals}
        />
        <main className={consoleStyles.consoleContent}>
          {!mfaEnrolled && (
            <div className={`${consoleStyles.banner} ${consoleStyles.bannerWarning}`} role="status">
              <span>
                Your account has no authenticator. Anyone with your password can sign in, and high-risk actions will ask
                you to set one up first.
              </span>
              <Button size="sm" onClick={() => setAuthenticatorOpen(true)}>
                Set up authenticator
              </Button>
            </div>
          )}
          <ConsoleBanners permissions={session.permissions} />
          {children}
        </main>
      </div>
      <PlatformCommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} permissions={session.permissions} />
      <AuthenticatorSetupDialog
        open={authenticatorOpen}
        onClose={() => setAuthenticatorOpen(false)}
        onEnrolled={() => setMfaEnrolled(true)}
      />
    </div>
  );
}
