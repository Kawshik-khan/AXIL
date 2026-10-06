# Restore rehearsals

Quarterly (FX-86, audit F27). The first one needs the owner's approval: it creates a Neon branch from production.

1. Neon console (or API): create a branch from the production branch **at a point in time** (e.g. 1 hour ago). Note
   the time you started.
2. Run the read-only checks against the branch (never production):

   ```bash
   RESTORE_DATABASE_URL="<branch connection string>" RESTORE_POINT="<ISO time restored to>" npm run db:restore-rehearsal -- --started "<ISO time you started>"
   ```

   It checks that every migration is applied, every table and document collection is readable, workspaces exist, and
   the newest write is within an hour of the restore point; and prints totals (orders, revenue, stock).
3. Optional, for a full proof: point a staging server at the branch (`DATABASE_URL`), start it, sign in, open an order.
4. Delete the branch. Paste the printed record below.

| Date | Who | Restore point | Minutes to verified | Pass | Notes |
|---|---|---|---|---|---|
| | | | | | |
