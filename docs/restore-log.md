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
| 2026-11-02 | Claude (approved by owner) | 2026-11-02 13:19:53 UTC (snapshot of `production`, project CommercesOS, restored to a new branch without finalizing) | 3 | Yes | All 7 migrations (006–012) applied; all 33 core tables and 63 document collections readable; 2 workspaces, 5,005 orders (৳15,281,252), 10,011 customers, 15,610 units on hand, identical to production. Production had 8 more documents, all written at 13:53, after the restore point, as expected. The checks were the script's queries, run read-only through the Neon console API instead of `npm run db:restore-rehearsal`, so the branch's connection string (same role password as production) never left Neon. Branch and snapshot deleted afterwards. **Finding:** the project keeps only 6 hours of history (`history_retention_seconds` 21600), so a point-in-time restore can't go further back than that; raise it (paid plan) or take daily snapshots |
