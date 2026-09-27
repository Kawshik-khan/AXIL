/**
 * CommerceOS — Database Migration Runner
 * Executes SQL migration files against Neon PostgreSQL in order.
 * 
 * Usage:
 *   npx tsx src/infrastructure/db/migrate.ts
 *   
 * Or via npm script:
 *   npm run db:migrate
 */

import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

async function runMigrations() {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    console.error('   Set it in .env.local or export it before running migrations.');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);
  const migrationsDir = path.join(__dirname, 'migrations');

  console.log('🚀 CommerceOS Database Migration Runner');
  console.log('━'.repeat(50));
  console.log(`📁 Migrations directory: ${migrationsDir}`);

  // Ensure migrations table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT clock_timestamp()
    )
  `;

  // Get already applied migrations
  const applied = await sql`SELECT name FROM _migrations ORDER BY id`;
  const appliedNames = new Set(applied.map((r: any) => r.name));

  // Read migration files
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('⚠️  No migration files found.');
    return;
  }

  let migrationsRun = 0;

  for (const file of files) {
    const migrationName = file.replace('.sql', '');
    
    if (appliedNames.has(migrationName)) {
      console.log(`  ✅ ${file} (already applied)`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');

    console.log(`  🔄 Applying ${file}...`);
    
    let currentStatement = '';
    try {
      // Execute the migration SQL
      // Strip pure comment lines first so header comments do not discard the first statement
      const cleanSql = sqlContent
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

      const statements = cleanSql
        .split(/;\s*$/m)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        currentStatement = statement;
        await sql.query(statement);
      }

      await sql`INSERT INTO _migrations (name) VALUES (${migrationName}) ON CONFLICT (name) DO NOTHING`;

      console.log(`  ✅ ${file} applied successfully.`);
      migrationsRun++;
    } catch (error: any) {
      console.error(`  ❌ Failed to apply ${file}:`);
      console.error(`     ${error.message}`);
      console.error(`     Failing statement snippet: ${currentStatement.slice(0, 200)}`);
      process.exit(1);
    }
  }

  console.log('━'.repeat(50));
  if (migrationsRun === 0) {
    console.log('✅ Database is up to date. No new migrations to apply.');
  } else {
    console.log(`✅ Successfully applied ${migrationsRun} migration(s).`);
  }
}

// Run if executed directly
runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
