import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { Redis } from 'ioredis';
assert.ok(
  process.argv.includes('--maintenance'),
  'Stop every writer and pass --maintenance. External writers must also be stopped.',
);
const lines = execFileSync(
  'docker',
  ['compose', 'ps', '--all', '--format', 'json', 'api', 'worker', 'scheduler', 'migrate'],
  { encoding: 'utf8' },
).trim();
const services = lines
  ? lines.split('\n').flatMap((line) => {
      const value = JSON.parse(line);
      return Array.isArray(value) ? value : [value];
    })
  : [];
assert.ok(
  !services.some((service) => service.State === 'running' || service.State === 'restarting'),
  'Local writers are still running. Stop them before resetting the cache fence.',
);
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  query_timeout: 12000,
});
const r = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
try {
  await db.connect();
  await r.connect();
  const active = await db.query(
    'SELECT count(*)::int count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL',
  );
  assert.equal(active.rows[0].count, 0, 'Wait for all database transactions to finish.');
  await r.eval(
    "redis.call('SET',KEYS[1],ARGV[1]);redis.call('DEL',KEYS[2]);return 1",
    2,
    'delivery:epoch',
    'delivery:writers',
    randomUUID(),
  );
  console.log('Delivery generation rotated and writer fence reset after maintenance checks.');
} finally {
  await db.end().catch(() => {});
  if (r.status !== 'end') await r.quit().catch(() => {});
}
