/** This app's public base URL (APP_URL), for webhooks providers call back on. Null when it isn't configured. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_URL?.trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin : null;
  } catch {
    return null;
  }
}
