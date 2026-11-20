/**
 * Hand-off of the email typed on the landing page to the sign-up form. It goes through sessionStorage (this tab only,
 * gone when the tab closes), never the URL, so the address stays out of logs and browser history.
 */
export const SIGNUP_EMAIL_KEY = "commerceos:signup-email";

export function saveSignupEmail(email: string): void {
  const value = email.trim();
  if (!value) return;
  try {
    window.sessionStorage.setItem(SIGNUP_EMAIL_KEY, value);
  } catch {
    // Private windows can refuse storage; the sign-up page then simply starts empty.
  }
}

/** Reads the hand-off once and clears it, so a later visit to /register starts empty. */
export function takeSignupEmail(): string {
  try {
    const value = window.sessionStorage.getItem(SIGNUP_EMAIL_KEY) ?? "";
    window.sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    return value.slice(0, 254);
  } catch {
    return "";
  }
}
