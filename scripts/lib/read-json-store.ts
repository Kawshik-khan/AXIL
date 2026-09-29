/**
 * Import this FIRST in scripts whose source is the JSON store file (the backfill and its verification). The process
 * store becomes a read-only copy of that file: the JSON backend whatever DATA_BACKEND says, no writer lock, no writes,
 * no default seed, no background sweeper (Phase 4 security review L7). The scripts still refuse to run while the app
 * owns the file (scripts/lib/store-session.ts).
 */
import type { CommerceDatabase } from "@/infrastructure/db";

process.env.DATA_BACKEND = "json";
(globalThis as typeof globalThis & { __commerceosDbFactory?: (store: typeof CommerceDatabase) => CommerceDatabase }).__commerceosDbFactory = (
  Store
) => new Store({ backend: "json", persist: false, seed: false });

export {};
