#!/usr/bin/env npx tsx
/**
 * Load test for Planner page — PERF-06
 * Target: 50 concurrent connections, p99 < 500ms
 * Usage: npx tsx scripts/load-test-planner.ts
 * Requires: local dev server running (npm run dev) or BASE_URL env var
 */
import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const AUTH_COOKIE = process.env.E2E_AUTH_COOKIE ?? '';

async function runLoadTest(): Promise<void> {
  console.log(`\nLoad testing ${BASE_URL}/planner`);
  console.log(`Connections: 50 | Duration: 30s\n`);

  const result = await autocannon({
    url: `${BASE_URL}/planner`,
    connections: 50,
    duration: 30,
    headers: {
      ...(AUTH_COOKIE ? { cookie: AUTH_COOKIE } : {}),
    },
  });

  console.log('\n--- Results ---');
  console.log(`Requests:    ${result.requests.total} total (${result.requests.average}/sec avg)`);
  console.log(`Latency p50: ${result.latency.p50}ms`);
  console.log(`Latency p99: ${result.latency.p99}ms`);
  console.log(`Latency avg: ${result.latency.average}ms`);
  console.log(`Throughput:  ${(result.throughput.average / 1024).toFixed(1)} KB/sec avg`);
  console.log(`Errors:      ${result.errors}`);
  console.log(`Timeouts:    ${result.timeouts}`);

  const pass = result.latency.p99 < 500;
  console.log(`\nTarget: p99 < 500ms`);
  console.log(`Result: ${pass ? 'PASS' : 'FAIL'} (p99 = ${result.latency.p99}ms)\n`);

  if (!pass) {
    process.exit(1);
  }
}

runLoadTest().catch((error) => {
  console.error('Load test failed:', error);
  process.exit(1);
});
