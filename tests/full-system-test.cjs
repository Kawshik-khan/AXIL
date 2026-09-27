const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testSuites = [
  { name: 'Phase 0: Security Regression (audit C1-C8, H1, H5, H10)', file: 'tests/security-regression-tests.ts' },
  { name: 'Phase 1 (remediation): RBAC Matrix', file: 'tests/rbac-matrix-tests.ts' },
  { name: 'Phase 1: Auth & IAM Security', file: 'tests/run-tests.ts' },
  { name: 'Phase 2: Commerce Core & Catalog', file: 'tests/commerce-tests.ts' },
  { name: 'Phase 3: Social Commerce & Meta Ingress', file: 'tests/social-tests.ts' },
  { name: 'Phase 4: Agentic AI & RAG Retrieval', file: 'tests/ai-tests.ts' },
  { name: 'Phase 5: Orchestration & Event Outbox', file: 'tests/orchestration-tests.ts' },
  { name: 'Phase 6: Multi-Agent Intelligence', file: 'tests/intelligence-tests.ts' },
  { name: 'Phase 7: Growth & Retention Engine', file: 'tests/growth-tests.ts' },
  { name: 'Phase 8: Operations & Logistics', file: 'tests/operations-tests.ts' },
  { name: 'Phase 9: Enterprise & Governance', file: 'tests/enterprise-tests.ts' },
  { name: 'Phase 10: Autonomous Operations', file: 'tests/autonomous-tests.ts' },
  { name: 'Phase 11: Automation Hub & Visual Rules', file: 'tests/automation-hub-tests.ts' },
  { name: 'Connectors & Platform Sync', file: 'tests/connectors-tests.ts' },
  { name: 'Marketing Campaigns & Segments', file: 'tests/marketing-tests.ts' },
  { name: 'Analytics & Golden Signals', file: 'tests/analytics-tests.ts' },
  { name: 'Neon PostgreSQL Repositories', file: 'tests/neon-integration-tests.ts' },
  { name: 'Pinecone Vector RAG Isolation', file: 'tests/pinecone-rag-tests.ts' },
  { name: 'Upstash Redis Caching & Locks', file: 'tests/redis-integration-tests.ts' },
];

console.log('====================================================');
console.log('   COMMERCEOS FULL SYSTEM VERIFICATION HARNESS     ');
console.log('====================================================\n');

const results = [];
let totalPassed = 0;
let totalFailed = 0;
const startTime = Date.now();

for (const suite of testSuites) {
  const suiteStart = Date.now();
  process.stdout.write(`Running ${suite.name} (${suite.file})... `);

  const proc = spawnSync('node', ['tests/ts-runner.cjs', suite.file], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NODE_ENV: 'test' }
  });

  const durationMs = Date.now() - suiteStart;
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';
  const success = proc.status === 0;

  // Extract pass / fail counts
  const passMatches = stdout.match(/✓ PASS/g) || [];
  const failMatches = stdout.match(/✗ FAIL/g) || [];
  const suitePassed = passMatches.length;
  const suiteFailed = failMatches.length + (success ? 0 : (failMatches.length === 0 ? 1 : 0));

  totalPassed += suitePassed;
  totalFailed += suiteFailed;

  if (success && suiteFailed === 0) {
    console.log(`✅ PASSED (${suitePassed} tests, ${(durationMs / 1000).toFixed(1)}s)`);
  } else {
    console.log(`❌ FAILED (${suitePassed} passed, ${suiteFailed} failed, ${(durationMs / 1000).toFixed(1)}s)`);
    if (stderr) console.error(`   Error: ${stderr.slice(0, 300)}`);
  }

  results.push({
    name: suite.name,
    file: suite.file,
    status: success && suiteFailed === 0 ? 'PASSED' : 'FAILED',
    testsPassed: suitePassed,
    testsFailed: suiteFailed,
    durationMs,
    exitCode: proc.status,
    stdoutSample: stdout.slice(-500),
    error: stderr ? stderr.slice(0, 500) : null
  });
}

const totalDurationMs = Date.now() - startTime;

console.log('\n====================================================');
console.log('             FULL SYSTEM TEST SUMMARY               ');
console.log('====================================================');
console.log(`Total Test Suites : ${testSuites.length}`);
console.log(`Suites Passed     : ${results.filter(r => r.status === 'PASSED').length}`);
console.log(`Suites Failed     : ${results.filter(r => r.status === 'FAILED').length}`);
console.log(`Total Unit/Integ  : ${totalPassed + totalFailed}`);
console.log(`Individual Passed : ${totalPassed}`);
console.log(`Individual Failed : ${totalFailed}`);
console.log(`Total Time        : ${(totalDurationMs / 1000).toFixed(1)}s`);
console.log('====================================================\n');

// Write machine-readable results
fs.writeFileSync(
  path.resolve(__dirname, 'test-results.json'),
  JSON.stringify({
    timestamp: new Date().toISOString(),
    totalDurationMs,
    totalPassed,
    totalFailed,
    suites: results
  }, null, 2)
);

if (totalFailed > 0) {
  process.exit(1);
}
