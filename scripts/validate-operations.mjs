import { Client } from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, createWriteStream } from 'node:fs';
import assert from 'node:assert/strict';
const suffix = randomBytes(6).toString('hex'),
  databaseName = 'operations_' + suffix,
  redisName = 'orbit-operations-' + suffix;
assert.match(databaseName, /^operations_[a-f0-9]{12}$/);
const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const children = [];
let created = false,
  redisCreated = false;
mkdirSync('reports', { recursive: true });
function command(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, 'Docker fixture command failed: ' + (r.stderr ?? ''));
  return r.stdout.trim();
}
function launch(file, env, label) {
  const log = createWriteStream('reports/operations-' + label + '.log');
  const child = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  return child;
}
async function wait(url) {
  for (let n = 0; n < 720; n++) {
    if (children.some((c) => c.exitCode !== null))
      throw new Error('An isolated service exited; inspect operations logs.');
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Isolated fixture failed readiness.');
}
try {
  await admin.query('CREATE DATABASE "' + databaseName + '"');
  created = true;
  command([
    'run',
    '--rm',
    '-d',
    '--name',
    redisName,
    '-p',
    '127.0.0.1::6379',
    'redis:8.10.2-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0',
  ]);
  redisCreated = true;
  const port = command(['port', redisName, '6379/tcp']).match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(port);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + databaseName;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    REDIS_URL: 'redis://127.0.0.1:' + port,
    PORT: '4500',
    DELIVERY_PORT: '4501',
    PUBLIC_ORIGIN: 'http://localhost:4500',
    ADMIN_ORIGIN: 'http://localhost:4500',
    TEST_API_ORIGIN: 'http://localhost:4500',
    TEST_DELIVERY_ORIGIN: 'http://localhost:4501',
    TRUST_PROXY: 'false',
    OPERATOR_TEST_PREFIX: 'ops' + suffix,
    MODERATOR_EMAILS: ['modone', 'modtwo']
      .map((v) => 'ops' + suffix + v + '@example.test')
      .join(','),
  };
  const migration = spawnSync(process.execPath, ['dist/packages/core/src/migrate.js'], {
    env,
    stdio: 'inherit',
  });
  assert.equal(migration.status, 0);
  launch('dist/apps/api/src/main.js', env, 'api');
  launch('dist/apps/worker/src/main.js', env, 'worker');
  launch('dist/apps/delivery/src/main.js', env, 'delivery');
  await Promise.all([
    wait(env.PUBLIC_ORIGIN + '/health/ready'),
    wait(env.TEST_DELIVERY_ORIGIN + '/health'),
    wait('http://localhost:4010/health'),
  ]);
  const test = spawn(process.execPath, ['scripts/operations-integration.mjs'], {
    env,
    stdio: 'inherit',
  });
  await new Promise((resolve, reject) => {
    test.once('error', reject);
    test.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Operational integration failed.')),
    );
  });
  console.log('Isolated operational services and database passed.');
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(
    children.map(
      (c) =>
        new Promise((r) => {
          if (c.exitCode !== null) return r();
          c.once('exit', r);
          setTimeout(() => {
            c.kill('SIGKILL');
            r();
          }, 5000).unref();
        }),
    ),
  );
  if (redisCreated) command(['rm', '-f', redisName]);
  if (created) {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query('DROP DATABASE "' + databaseName + '"');
  }
  await admin.end();
}
