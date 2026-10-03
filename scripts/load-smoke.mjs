import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080',
  latencies = [],
  statuses = {};
const count = 100,
  concurrency = 5;
let completed = 0;
const start = performance.now();
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (completed < count) {
      const n = completed++,
        tick = performance.now();
      const response = await fetch(
        origin + '/avatar/load-smoke-' + (n % 10) + '?size=128&format=svg',
      );
      const body = await response.text();
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      assert.equal(response.status, 200, 'Avatar request must succeed');
      assert.ok(body.startsWith('<svg'), 'Response must be actual SVG');
      latencies.push(performance.now() - tick);
      // Stay within the documented reverse-proxy and delivery quotas.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }),
);
latencies.sort((a, b) => a - b);
const result = {
  kind: 'local-load-smoke',
  requests: count,
  concurrency,
  elapsedMs: Math.round(performance.now() - start),
  p50Ms: Math.round(latencies[Math.floor(count * 0.5)]),
  p95Ms: Math.round(latencies[Math.floor(count * 0.95)]),
  p99Ms: Math.round(latencies[Math.floor(count * 0.99)]),
  statuses,
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/load-smoke.json', JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result) + '\n');
assert.ok(result.p95Ms < 1000, 'Local avatar smoke p95 must remain under one second');
