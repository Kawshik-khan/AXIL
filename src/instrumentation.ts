/**
 * Runs once when a Next.js server starts (ADR-108). The Node.js-only part is a separate module inside a runtime check,
 * so the edge build (which has no fs, crypto or Postgres) never includes it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadStore } = await import("./instrumentation-node");
    await loadStore();
  }
}
