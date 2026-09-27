/**
 * CommerceOS — Infrastructure Health Check
 * Verifies connectivity to Neon PostgreSQL, Pinecone, and Upstash Redis.
 * 
 * Usage:
 *   npm run db:health
 */

import { healthCheck as neonHealth } from '../neon/client';
import { healthCheck as pineconeHealth } from '../pinecone/client';
import { healthCheck as redisHealth } from '../redis/client';

async function checkHealth() {
  console.log('🏥 CommerceOS Infrastructure Health Check');
  console.log('━'.repeat(50));

  // Neon PostgreSQL
  const pgResult = await neonHealth();
  const pgIcon = pgResult.ok ? '✅' : '❌';
  console.log(`  ${pgIcon} Neon PostgreSQL: ${pgResult.ok ? 'Connected' : 'FAILED'} (${pgResult.latencyMs}ms)${pgResult.error ? ` — ${pgResult.error}` : ''}`);

  // Pinecone
  let pcResult = { ok: false, latencyMs: 0 };
  if (process.env.PINECONE_API_KEY) {
    pcResult = await pineconeHealth();
    const pcIcon = pcResult.ok ? '✅' : '❌';
    console.log(`  ${pcIcon} Pinecone:        ${pcResult.ok ? 'Connected' : 'FAILED'} (${pcResult.latencyMs}ms)`);
  } else {
    console.log(`  ⚠️  Pinecone:        Skipped (PINECONE_API_KEY not set)`);
  }

  // Upstash Redis
  let rdResult = { ok: false, latencyMs: 0 };
  if (process.env.UPSTASH_REDIS_REST_URL) {
    rdResult = await redisHealth();
    const rdIcon = rdResult.ok ? '✅' : '❌';
    console.log(`  ${rdIcon} Upstash Redis:   ${rdResult.ok ? 'Connected' : 'FAILED'} (${rdResult.latencyMs}ms)`);
  } else {
    console.log(`  ⚠️  Upstash Redis:   Skipped (UPSTASH_REDIS_REST_URL not set)`);
  }

  console.log('━'.repeat(50));

  const allOk = pgResult.ok;
  if (allOk) {
    console.log('✅ Core infrastructure healthy.');
  } else {
    console.log('❌ One or more critical services are unreachable.');
    process.exit(1);
  }
}

checkHealth().catch((err) => {
  console.error('❌ Health check failed:', err.message);
  process.exit(1);
});
