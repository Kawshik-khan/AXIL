/**
 * CommerceOS — Infrastructure Health Check
 * Verifies connectivity to Neon PostgreSQL, Qdrant, and Upstash Redis.
 * 
 * Usage:
 *   npm run db:health
 */

import { healthCheck as neonHealth } from '../neon/client';
import { healthCheck as qdrantHealth } from '../qdrant/client';
import { healthCheck as redisHealth } from '../redis/client';

async function checkHealth() {
  console.log('🏥 CommerceOS Infrastructure Health Check');
  console.log('━'.repeat(50));

  // Neon PostgreSQL
  const pgResult = await neonHealth();
  const pgIcon = pgResult.ok ? '✅' : '❌';
  console.log(`  ${pgIcon} Neon PostgreSQL: ${pgResult.ok ? 'Connected' : 'FAILED'} (${pgResult.latencyMs}ms)${pgResult.error ? ` — ${pgResult.error}` : ''}`);

  // Qdrant
  let pcResult = { ok: false, latencyMs: 0 };
  if (process.env.QDRANT_URL) {
    pcResult = await qdrantHealth();
    const pcIcon = pcResult.ok ? '✅' : '❌';
    console.log(`  ${pcIcon} Qdrant:          ${pcResult.ok ? 'Connected' : 'FAILED'} (${pcResult.latencyMs}ms)`);
  } else {
    console.log(`  ⚠️  Qdrant:          Skipped (QDRANT_URL not set)`);
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
