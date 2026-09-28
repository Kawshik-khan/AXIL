import fs from "fs";
import os from "os";
import path from "path";

/**
 * Single-writer guard for scripts that write the JSON store (FIX_IMPLEMENTATION_PLAN FX-24, audit C7).
 * The running app owns `.data/commerceos.lock`. A script that writes the store while the app runs overwrites the app's
 * writes (and the app overwrites the script's), so scripts refuse to start until the app is stopped.
 */
export function assertNoOtherStoreWriter(): void {
  const dataDir = process.env.COMMERCEOS_DATA_DIR ? path.resolve(process.env.COMMERCEOS_DATA_DIR) : path.join(process.cwd(), ".data");
  const lockPath = path.join(dataDir, "commerceos.lock");
  let owner: { pid?: number; host?: string; started_at?: string } | null = null;
  try {
    owner = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  } catch {
    return; // no lock: nobody else is writing
  }
  if (!owner?.pid || owner.pid === process.pid || owner.host !== os.hostname()) return;
  let alive = false;
  try {
    process.kill(owner.pid, 0);
    alive = true;
  } catch (err) {
    alive = (err as NodeJS.ErrnoException).code === "EPERM";
  }
  if (alive) {
    process.stderr.write(
      `The data store is in use by another process (pid ${owner.pid}, started ${owner.started_at}). ` +
        "Stop `npm run dev` (or that process) first; two writers lose each other's changes.\n"
    );
    process.exit(1);
  }
}
