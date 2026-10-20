/**
 * Provider sign-in in a popup (ADR-119): a page opens the provider's dialog in a named window; the OAuth callback lands
 * on that provider's picker page inside the window, which hands its query (`step=pick` or `error=CODE`) to the opener
 * with a same-origin postMessage and closes. Tokens never travel this way: they stay in the httpOnly cookie.
 */
export const SIGN_IN_PROVIDERS = {
  meta: { path: "/connector/facebook", popupName: "commerceos_facebook_login", dialogHost: "https://www.facebook.com/" },
  whatsapp: { path: "/connector/whatsapp", popupName: "commerceos_whatsapp_login", dialogHost: "https://www.facebook.com/" },
} as const;
export type SignInProvider = keyof typeof SIGN_IN_PROVIDERS;

export const META_POPUP_MESSAGE = "commerceos:meta-login";
/** @deprecated kept for older imports; use SIGN_IN_PROVIDERS.meta */
export const META_POPUP_NAME = SIGN_IN_PROVIDERS.meta.popupName;
export const META_PICKER_PATH = SIGN_IN_PROVIDERS.meta.path;

export interface MetaPopupMessage {
  type: typeof META_POPUP_MESSAGE;
  provider: SignInProvider;
  query: string;
}

const isProvider = (value: unknown): value is SignInProvider =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(SIGN_IN_PROVIDERS, value);

export function isMetaPopupMessage(event: MessageEvent): event is MessageEvent<MetaPopupMessage> {
  const data = event.data as Partial<MetaPopupMessage> | null;
  return (
    event.origin === window.location.origin &&
    !!data &&
    data.type === META_POPUP_MESSAGE &&
    isProvider(data.provider) &&
    typeof data.query === "string" &&
    /^(step=pick|error=[A-Z_]{1,64})$/.test(data.query)
  );
}

/** Where the opener goes after the popup reports back: that provider's picker, with the popup's query. */
export function pickerUrlOf(message: MetaPopupMessage): string {
  return `${SIGN_IN_PROVIDERS[message.provider].path}?${message.query}`;
}

/**
 * Inside the popup, on the picker page: hands the result to the window that opened it and closes. False when this page
 * isn't that provider's popup (or its opener is gone): the page then shows the picker itself.
 */
export function handOffSignInToOpener(provider: SignInProvider, query: string): boolean {
  if (typeof window === "undefined" || window.name !== SIGN_IN_PROVIDERS[provider].popupName || !query) return false;
  try {
    if (!window.opener || window.opener.closed) return false;
    const message: MetaPopupMessage = { type: META_POPUP_MESSAGE, provider, query };
    window.opener.postMessage(message, window.location.origin);
    window.close();
    return true;
  } catch {
    return false;
  }
}

/** The popup's query from a picker page's search params: `step=pick` or a short error code only. */
export function popupQueryOf(params: URLSearchParams): string {
  const error = params.get("error");
  return params.get("step") === "pick" ? "step=pick" : error && /^[A-Z_]{1,64}$/.test(error) ? `error=${error}` : "";
}

/**
 * Opens the popup at once (inside the click, so it isn't blocked), then points it at the provider's dialog.
 * Meta `features: ["ads"]` is Ad Manager's "Connect ads": Facebook also asks for `ads_read`.
 */
export async function startMetaLoginPopup(features: string[] = [], provider: SignInProvider = "meta"): Promise<void> {
  const width = 600;
  const height = 720;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const config = SIGN_IN_PROVIDERS[provider];
  const popup = window.open("about:blank", config.popupName, `width=${width},height=${height},left=${left},top=${top}`);
  try {
    const res = await fetch(`/api/v1/connections/${provider}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        res.status === 403 ? "Your role can't connect channels." : json?.error?.message ?? "Could not start the sign-in."
      );
    }
    const url = String(json.data?.url ?? "");
    if (!url.startsWith(config.dialogHost)) throw new Error("Could not start the sign-in.");
    if (popup && !popup.closed) popup.location.href = url;
    else window.location.href = url; // popup blocked: same tab instead
  } catch (err) {
    popup?.close();
    throw err;
  }
}
