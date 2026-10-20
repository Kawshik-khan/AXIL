/**
 * Provider sign-in adapters for the connection platform (ADR-119, docs/connection-platform-plan.md P1).
 * The broker (oauth-broker.ts) owns state, nonce, cookies and the connection record; an adapter only knows its provider.
 */
import type { Permission } from "@/lib/permissions";

/** A user token from a provider. Never leaves the server; stored encrypted on the connection. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
}

/** What the provider says about a token (inspection), as opposed to what was requested. */
export interface TokenInspection {
  /** The provider's id for the signed-in account (Facebook user id). */
  externalAccountId: string;
  scopes: string[];
  /** ISO time; undefined when the token doesn't expire. */
  expiresAt?: string;
  /** Objects a scope was granted on (Meta granular scopes: WhatsApp Business Account ids for whatsapp_business_*). */
  targets?: Record<string, string[]>;
}

export interface OAuthAdapter {
  /** URL slug: /api/v1/connections/{slug}/... */
  slug: string;
  /** The connector manifest id the connection is stored under. */
  providerId: string;
  /** Who may connect this provider. */
  permission: Permission;
  /** Prefix of the nonce and pending cookies (`${prefix}_oauth`, `${prefix}_pending`). */
  cookiePrefix: string;
  /** Where the browser lands after the callback (the resource picker). */
  pickerPath: string;
  /** Throws `<PROVIDER>_LOGIN_NOT_CONFIGURED` (503) when the platform app isn't set up. */
  assertConfigured(): void;
  authorizeUrl(input: { state: string; redirectUri: string; scopes: string[] }): string;
  /** Code → token, long-lived where the provider allows it. */
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  /** Asks the provider who the token belongs to, its scopes and expiry; refuses a token issued to another app. */
  inspect(token: TokenSet): Promise<TokenInspection>;
  /** The error code the callback reports when the user cancels the dialog. */
  deniedCode: string;
}
