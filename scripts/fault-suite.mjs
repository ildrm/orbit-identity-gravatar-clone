import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import argon2 from 'argon2';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const suffix = randomBytes(6).toString('hex'),
  prefix = 'orbit-fault-' + suffix,
  network = prefix + '-network',
  dir = resolve('reports/fault-' + suffix),
  names = [],
  checks = [],
  paused = new Set();
mkdirSync(dir, { recursive: true });
function command(args, timeout = 60_000) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function run(role, ip, image, args = [], options = []) {
  const name = prefix + '-' + role;
  command([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    '--ip',
    '11.255.254.' + ip,
    ...options,
    image,
    ...args,
  ]);
  names.push(name);
  return name;
}
function port(name, number) {
  const p = command(['port', name, number + '/tcp']).match(/127\.0\.0\.1:(\d+)/)?.[1];
  assert.ok(p, 'Fixture port');
  return p;
}
async function until(action, label, timeout = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const value = await action();
      if (value) return value;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error('Fixture timed out: ' + label);
}
function pass(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
  console.log('PASS ' + label);
}
function pause(name) {
  command(['pause', name]);
  paused.add(name);
}
function resume(name) {
  command(['unpause', name]);
  paused.delete(name);
}
const env = {
  NODE_ENV: 'test',
  PUBLIC_ORIGIN: 'http://11.255.254.50:4000',
  ADMIN_ORIGIN: 'http://11.255.254.50:4000',
  DATABASE_URL:
    'postgresql://identity:' + randomBytes(24).toString('hex') + '@11.255.254.10:5432/identity',
  REDIS_URL: 'redis://11.255.254.11:6379',
  S3_ENDPOINT: 'http://11.255.254.30:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'identity-media',
  S3_ACCESS_KEY: randomBytes(16).toString('hex'),
  S3_SECRET_KEY: randomBytes(32).toString('hex'),
  INTERNAL_API_KEY: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  EMAIL_FROM: 'fixture@example.test',
  SMTP_HOST: '11.255.254.20',
  SMTP_PORT: '1025',
  RP_ID: 'localhost',
  TRUST_PROXY: 'false',
  NODE_EXTRA_CA_CERTS: '/fixture/cert.pem',
};
let networkCreated = false,
  db,
  apiOrigin,
  deliveryOrigin,
  mailOrigin,
  cookie = '';
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(apiOrigin + path, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        Origin: env.PUBLIC_ORIGIN,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    text = await response.text();
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}
async function ok(path, options) {
  const r = await request(path, options);
  assert.ok(
    r.status >= 200 && r.status < 300,
    'Request failed: ' +
      path +
      ' status ' +
      r.status +
      ' code ' +
      (r.data?.code ?? r.data?.error ?? ''),
  );
  return r.data;
}
const received = () =>
  existsSync(dir + '/received.ndjson')
    ? readFileSync(dir + '/received.ndjson', 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
try {
  command(['network', 'create', '--internal', '--subnet', '11.255.254.0/24', network]);
  networkCreated = true;
  const certificate = spawnSync('php', ['scripts/fault-tls.php', dir], { encoding: 'utf8' });
  assert.equal(certificate.status, 0, 'Fixture certificate generation');
  writeFileSync(dir + '/mode.txt', 'success');
  copyFileSync('scripts/fault-receiver.mjs', dir + '/receiver.mjs');
  const forwarder = prefix + '-forwarder';
  copyFileSync('scripts/fault-forwarder.mjs', dir + '/forwarder.mjs');
  command([
    'run',
    '-d',
    '--name',
    forwarder,
    '--network',
    'bridge',
    '-v',
    dir + ':/fixture:ro',
    '--memory',
    '96m',
    ...['5432', '6379', '8025', '9000', '4000', '4001'].flatMap((p) => ['-p', '127.0.0.1::' + p]),
    'node:24.21.0-alpine3.24',
    'node',
    '/fixture/forwarder.mjs',
  ]);
  names.push(forwarder);
  command(['network', 'connect', '--ip', '11.255.254.60', network, forwarder]);
  const _receiver = run(
    'receiver',
    44,
    'node:24.21.0-alpine3.24',
    ['node', '/fixture/receiver.mjs'],
    ['-v', dir + ':/fixture', '--memory', '128m'],
  );
  await until(() => existsSync(dir + '/ready'), 'TLS receiver');
  const postgres = run(
    'postgres',
    10,
    'identity-platform-postgres',
    [],
    [
      '--tmpfs',
      '/var/lib/postgresql:rw,size=512m',
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_DB=identity',
      '-e',
      'POSTGRES_USER=identity',
      '-e',
      'POSTGRES_PASSWORD=' + new URL(env.DATABASE_URL).password,
      '--memory',
      '384m',
    ],
  );
  const redisName = run(
    'redis',
    11,
    'redis:8.10.2-alpine',
    ['redis-server', '--save', '', '--appendonly', 'no'],
    ['-p', '127.0.0.1::6379', '--memory', '128m'],
  );
  const mail = run(
    'mail',
    20,
    'axllent/mailpit:v1.31.3',
    [],
    ['-p', '127.0.0.1::8025', '--memory', '128m'],
  );
  mailOrigin = 'http://127.0.0.1:' + port(forwarder, 8025);
  writeFileSync(
    dir + '/s3.json',
    JSON.stringify({
      identities: [
        {
          name: 'fixture',
          credentials: [{ accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY }],
          actions: ['Admin', 'Read', 'List', 'Tagging', 'Write'],
        },
      ],
    }),
  );
  const object = run(
    'storage',
    30,
    'chrislusf/seaweedfs:4.48',
    [
      'server',
      '-dir=/data',
      '-s3',
      '-s3.port=9000',
      '-s3.config=/fixture/s3.json',
      '-ip=11.255.254.30',
      '-master.volumeSizeLimitMB=64',
    ],
    [
      '--tmpfs',
      '/data:rw,size=384m',
      '-v',
      dir + ':/fixture:ro',
      '-p',
      '127.0.0.1::9000',
      '--memory',
      '384m',
    ],
  );
  const s3Origin = 'http://127.0.0.1:' + port(forwarder, 9000);
  env.S3_PUBLIC_ENDPOINT = s3Origin;
  await until(
    () =>
      spawnSync('docker', ['exec', postgres, 'pg_isready', '-U', 'identity', '-d', 'identity'], {
        stdio: 'ignore',
      }).status === 0,
    'PostgreSQL initialization',
  );
  await until(async () => {
    await fetch(s3Origin, { signal: AbortSignal.timeout(1000) });
    return true;
  }, 'S3 initialization');
  const hostDb = new URL(env.DATABASE_URL);
  hostDb.hostname = '127.0.0.1';
  hostDb.port = port(forwarder, 5432);
  db = new Client({ connectionString: hostDb.toString(), query_timeout: 15_000 });
  await db.connect();
  const envFile = dir + '/runtime.env';
  writeFileSync(
    envFile,
    Object.entries(env)
      .map(([k, v]) => k + '=' + v)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  function oneShot(role, file) {
    const name = prefix + '-' + role;
    names.push(name);
    command(
      [
        'run',
        '--name',
        name,
        '--network',
        network,
        '--env-file',
        envFile,
        '-v',
        dir + ':/fixture:ro',
        'identity-platform-api',
        'node',
        file,
      ],
      180_000,
    );
  }
  oneShot('migrate', 'dist/packages/core/src/migrate.js');
  oneShot('storage-init', 'scripts/storage-init.mjs');
  writeFileSync(
    dir + '/storage-probe.mjs',
    "import {putObject,deleteObject} from '/app/dist/packages/core/src/storage.js';await putObject('fixture-self-test','bounded storage probe','text/plain');await deleteObject('fixture-self-test');",
  );
  try {
    oneShot('storage-probe', '/fixture/storage-probe.mjs');
  } catch {
    const log = command(['logs', '--tail', '70', object]);
    writeFileSync(dir + '/storage-failure.log', log);
    throw Error('Isolated S3 fixture failed its first write; inspect the bounded fixture log.');
  }
  const api = run(
    'api',
    50,
    'identity-platform-api',
    ['node', 'dist/apps/api/src/main.js'],
    [
      '--env-file',
      envFile,
      '-v',
      dir + ':/fixture:ro',
      '-p',
      '127.0.0.1::4000',
      '--memory',
      '512m',
    ],
  );
  apiOrigin = 'http://127.0.0.1:' + port(forwarder, 4000);
  const worker = run(
    'worker',
    51,
    'identity-platform-api',
    ['node', 'dist/apps/worker/src/main.js'],
    ['--env-file', envFile, '-v', dir + ':/fixture:ro', '--memory', '512m'],
  );
  const scheduler = run(
    'scheduler',
    52,
    'identity-platform-api',
    ['node', 'dist/apps/scheduler/src/main.js'],
    ['--env-file', envFile, '-v', dir + ':/fixture:ro', '--memory', '256m'],
  );
  const _delivery = run(
    'delivery',
    53,
    'identity-platform-api',
    ['node', 'dist/apps/delivery/src/main.js'],
    [
      '--env-file',
      envFile,
      '-v',
      dir + ':/fixture:ro',
      '-p',
      '127.0.0.1::4001',
      '--memory',
      '256m',
    ],
  );
  deliveryOrigin = 'http://127.0.0.1:' + port(forwarder, 4001);
  await until(async () => (await fetch(apiOrigin + '/health/ready')).ok, 'API readiness');
  const accountId = 'acc_' + randomBytes(16).toString('hex'),
    email = 'fault' + suffix + '@example.test',
    password = 'Fault-fixture-real-authentication!2026',
    hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  await db.query(
    'INSERT INTO accounts(id,email,password_hash,verified_at) VALUES($1,$2,$3,now())',
    [accountId, email, hash],
  );
  await ok('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  const person = await ok('/api/v1/identities', {
      method: 'POST',
      body: {
        type: 'PERSON',
        handle: 'fault' + suffix,
        displayName: 'Fault fixture public identity',
      },
    }),
    path = '/api/v1/identities/' + person.id;
  const pub = {
    visibility: 'PUBLIC',
    searchable: true,
    indexable: true,
    machine: true,
    agent: false,
  };
  await ok(path + '/settings', { method: 'PUT', body: pub });
  const app = await ok('/api/v1/applications', {
    method: 'POST',
    body: { name: 'Isolated webhook consumer', purpose: 'Transport and failure validation' },
  });
  const hook = await ok('/api/v1/applications/' + app.id + '/webhooks', {
    method: 'POST',
    body: { url: 'https://11.255.254.44/hook', events: ['identity.updated', 'profile.updated'] },
  });
  writeFileSync(dir + '/secret.txt', hook.secret);
  const hookPath = '/api/v1/applications/' + app.id + '/webhooks/' + hook.id;
  const testHook = () => ok(hookPath + '/test', { method: 'POST' });
  async function done(job) {
    return until(
      async () =>
        (await db.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0]?.status ===
        'COMPLETED',
      'completed delivery',
    );
  }
  const first = await testHook();
  await done(first);
  pass(
    received().some((r) => r.signatureValid && r.status === 204),
    'Real HTTPS receiver verifies the production worker HMAC signature',
  );
  writeFileSync(dir + '/mode.txt', 'fail');
  const failed = await testHook();
  await until(
    async () =>
      (await db.query('SELECT attempts,status FROM jobs WHERE id=$1', [failed.id])).rows.some(
        (r) => r.attempts >= 1 && r.status === 'PENDING',
      ),
    'HTTP receiver failure retry',
  );
  const original = received().at(-1);
  pass(
    original.signatureValid && original.status === 503,
    'Receiver rejection preserves a signed retryable delivery',
  );
  writeFileSync(dir + '/mode.txt', 'success');
  await done(failed);
  const retry = received().filter((r) => r.delivery === original.delivery);
  pass(
    retry.length >= 2 && retry.every((r) => r.signatureValid) && retry.at(-1).status === 204,
    'Webhook retries keep the same delivery and event identifiers',
  );
  await ok('/api/v1/applications/' + app.id + '/deliveries/' + failed.id + '/replay', {
    method: 'POST',
  });
  await done(failed);
  pass(
    received().filter((r) => r.delivery === original.delivery).length >= 3,
    'Developer replay reuses the original idempotency identifier over HTTPS',
  );
  pass(
    received().filter((r) => r.delivery === original.delivery && r.sideEffectApplied).length === 1,
    'Receiver deduplication prevents replay from applying a second business side effect',
  );
  writeFileSync(dir + '/mode.txt', 'hold');
  const killedJob = await testHook();
  await until(() => received().at(-1)?.status === 0, 'in-flight delivery before crash');
  const killedDelivery = received().at(-1).delivery;
  command(['kill', '--signal', 'KILL', worker]);
  pass(
    (await db.query('SELECT status FROM jobs WHERE id=$1', [killedJob.id])).rows[0].status ===
      'RUNNING',
    'A worker crash preserves the leased durable job',
  );
  writeFileSync(dir + '/mode.txt', 'success');
  command(['start', worker]);
  await done(killedJob);
  pass(
    received().filter((r) => r.delivery === killedDelivery && r.sideEffectApplied).length === 1 &&
      (await db.query('SELECT attempts FROM jobs WHERE id=$1', [killedJob.id])).rows[0].attempts >=
        2,
    'Worker restart reclaims an expired lease and completes the same delivery once',
  );
  const rotated = await ok(hookPath + '/rotate', { method: 'POST' });
  writeFileSync(dir + '/secret.txt', rotated.secret);
  const afterRotate = await testHook();
  await done(afterRotate);
  pass(
    received().at(-1).signatureValid,
    'Rotated webhook signing secret is used by actual subsequent deliveries',
  );
  await ok(hookPath + '/settings', { method: 'PUT', body: { enabled: false } });
  pass(
    (await request(hookPath + '/test', { method: 'POST' })).status === 404,
    'Disabled webhook cannot queue another developer test',
  );
  await ok(hookPath + '/settings', { method: 'PUT', body: { enabled: true } });
  const grant = await ok(path + '/consents', {
    method: 'POST',
    body: {
      applicationId: app.id,
      scopes: ['identity.read', 'profile.basic'],
      fields: ['core:display_name'],
    },
  });
  const beforeEvents = received().length;
  await ok(path + '/settings', { method: 'PUT', body: pub });
  await until(() => received().length > beforeEvents, 'ordinary consented webhook');
  pass(
    received().at(-1).event.identityId === person.id && !('data' in received().at(-1).event),
    'Ordinary webhook emits only bounded event metadata under current consent',
  );
  await ok(path + '/consents/' + grant.id, { method: 'DELETE' });
  const revokedCount = received().length;
  await ok(path + '/settings', { method: 'PUT', body: pub });
  await until(
    async () =>
      (
        await db.query(
          "SELECT 1 FROM jobs WHERE status IN ('PENDING','RUNNING') AND kind IN ('event','webhook')",
        )
      ).rowCount === 0,
    'revoked event drain',
  );
  pass(
    received().length === revokedCount,
    'Consent revocation stops real subsequent webhook disclosure',
  );
  pause(postgres);
  try {
    pass(
      (await fetch(apiOrigin + '/health/ready', { signal: AbortSignal.timeout(20_000) })).status ===
        503,
      'PostgreSQL outage removes API readiness',
    );
  } finally {
    resume(postgres);
  }
  await until(async () => (await fetch(apiOrigin + '/health/ready')).ok, 'database recovery');
  pass(
    (await request('/api/v1/profiles/' + person.id)).status === 200,
    'PostgreSQL recovery restores authorized reads',
  );
  const pixels = await sharp({
    create: { width: 40, height: 30, channels: 4, background: '#8445cc' },
  })
    .png()
    .toBuffer();
  const media = await ok(path + '/media/upload', {
    method: 'POST',
    body: { bytes: pixels.length, alt: 'Storage failure fixture', purpose: 'AVATAR' },
  });
  const uploaded = await fetch(media.url, { method: 'PUT', body: pixels, headers: media.headers });
  if (!uploaded.ok) {
    const failure = await uploaded.text();
    throw Error(
      'Fixture upload failed HTTP ' +
        uploaded.status +
        ' code ' +
        (failure.match(/<Code>([A-Za-z0-9_]+)<\/Code>/)?.[1] ?? 'unknown') +
        ' ' +
        (failure.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? '')
          .replace(/https?:\/\/[^\s<>]+/g, '[fixture URL]')
          .slice(0, 600),
    );
  }
  pause(worker);
  await ok(path + '/media/' + media.id + '/complete', { method: 'POST' });
  pause(object);
  resume(worker);
  await until(
    async () =>
      (
        await db.query(
          "SELECT status,attempts FROM jobs WHERE kind='media' AND payload->>'mediaId'=$1",
          [media.id],
        )
      ).rows.some((j) => j.attempts >= 1 && j.status === 'PENDING'),
    'object storage retry',
  );
  pass(
    (await db.query('SELECT status FROM media WHERE id=$1', [media.id])).rows[0].status ===
      'PROCESSING',
    'Unavailable object storage leaves quarantined media unpublished and retryable',
  );
  resume(object);
  await until(
    async () =>
      (await db.query('SELECT status FROM media WHERE id=$1', [media.id])).rows[0].status ===
      'READY',
    'media recovery',
  );
  pass(
    (await db.query('SELECT variants FROM media WHERE id=$1', [media.id])).rows[0].variants[
      '1024.avif'
    ] !== undefined,
    'Object storage recovery generates every responsive format',
  );
  pause(mail);
  const proof = (await ok('/api/v1/auth/stepup', { method: 'POST', body: { password } })).proof,
    newEmail = 'fault' + suffix + '-changed@example.test';
  await ok('/api/v1/account/email', { method: 'POST', body: { email: newEmail, proof } });
  await until(
    async () =>
      (await db.query("SELECT 1 FROM jobs WHERE kind='email' AND status='PENDING' AND attempts>=1"))
        .rowCount > 0,
    'SMTP retry',
  );
  pass(
    (await db.query('SELECT email FROM accounts WHERE id=$1', [accountId])).rows[0].email === email,
    'SMTP outage cannot replace the current verified email',
  );
  resume(mail);
  const deliveredMail = await until(async () => {
    const list = await fetch(mailOrigin + '/api/v1/messages').then((r) => r.json());
    return list.messages.some((m) => m.To.some((t) => t.Address === newEmail));
  }, 'SMTP recovery');
  pass(
    Boolean(deliveredMail),
    'SMTP recovery delivers the previously queued account-bound verification code',
  );
  const domain = await ok(path + '/domains', {
    method: 'POST',
    body: { domain: 'fault' + suffix + '.invalid' },
  });
  pass(
    (await request(path + '/domains/' + domain.id + '/verify', { method: 'POST' })).status === 400,
    'Actual failed DNS ownership verification grants no publication authority',
  );
  Object.assign(process.env, env);
  const { encrypt } = await import('../dist/packages/core/src/security.js'),
    connectionId = 'prv_' + randomBytes(16).toString('hex'),
    providerJob = 'job_' + randomBytes(16).toString('hex');
  await db.query(
    "INSERT INTO provider_connections(id,identity_id,provider,provider_id,username,token_encrypted,fields,mode,actor_id) VALUES($1,$2,'github','101','fixture',$3,'[\"bio\"]','SYNC',$4)",
    [connectionId, person.id, encrypt('isolated-unusable-provider-fixture'), accountId],
  );
  const claimsBefore = (
    await db.query('SELECT count(*) FROM claims WHERE identity_id=$1', [person.id])
  ).rows[0].count;
  await db.query("INSERT INTO jobs(id,kind,payload) VALUES($1,'provider-sync',$2)", [
    providerJob,
    JSON.stringify({ connectionId, requestId: 'fault-' + suffix }),
  ]);
  await until(
    async () =>
      (await db.query('SELECT status,attempts FROM jobs WHERE id=$1', [providerJob])).rows.some(
        (j) => j.status === 'PENDING' && j.attempts >= 1,
      ),
    'external provider network failure',
  );
  pass(
    (await db.query('SELECT count(*) FROM claims WHERE identity_id=$1', [person.id])).rows[0]
      .count === claimsBefore &&
      (await db.query('SELECT last_error FROM provider_connections WHERE id=$1', [connectionId]))
        .rows[0].last_error !== null,
    'Provider network failure records an error and imports no unverified claims',
  );
  for (let attempt = 2; attempt <= 3; attempt++) {
    await db.query('UPDATE jobs SET run_after=now() WHERE id=$1', [providerJob]);
    await until(
      async () =>
        (await db.query('SELECT status,attempts FROM jobs WHERE id=$1', [providerJob])).rows.some(
          (j) => j.status === 'PENDING' && j.attempts >= attempt,
        ),
      'provider repeated failure',
    );
  }
  const circuitName =
    'provider:github:' +
    createHash('sha256').update('isolated-unusable-provider-fixture').digest('hex') +
    ':open';
  pass(
    command(['exec', redisName, 'redis-cli', 'EXISTS', circuitName]) === '1',
    'Repeated provider network failures open the production Redis circuit breaker',
  );
  await db.query('UPDATE provider_connections SET revoked_at=now() WHERE id=$1', [connectionId]);
  await db.query('UPDATE jobs SET run_after=now() WHERE id=$1', [providerJob]);
  await done({ id: providerJob });
  pass(
    (await db.query('SELECT count(*) FROM claims WHERE identity_id=$1', [person.id])).rows[0]
      .count === claimsBefore,
    'Disconnected provider jobs complete without fetching or importing',
  );
  await db.query('UPDATE identities SET federation_enabled=true WHERE id=$1', [person.id]);
  command(['restart', scheduler]);
  await until(
    async () =>
      (
        await db.query(
          "SELECT 1 FROM jobs WHERE kind='event' AND payload->>'identityId'=$1 AND payload->>'type'='federation.refresh'",
          [person.id],
        )
      ).rowCount > 0,
    'scheduler first tick',
  );
  const scheduled = (
    await db.query(
      "SELECT count(*) FROM jobs WHERE kind='event' AND payload->>'identityId'=$1 AND payload->>'type'='federation.refresh'",
      [person.id],
    )
  ).rows[0].count;
  command(['restart', scheduler]);
  await new Promise((r) => setTimeout(r, 1500));
  pass(
    (
      await db.query(
        "SELECT count(*) FROM jobs WHERE kind='event' AND payload->>'identityId'=$1 AND payload->>'type'='federation.refresh'",
        [person.id],
      )
    ).rows[0].count === scheduled,
    'Scheduler restart preserves deterministic hourly outbox idempotency',
  );
  await (
    await import('./fixture-performance.mjs')
  ).performanceChecks({
    db,
    request,
    ok,
    apiOrigin,
    deliveryOrigin,
    person,
    path,
    app,
    accountId,
    email,
    password,
    dir,
    hookPath,
    received,
    done,
    testHook,
    redisPort: port(forwarder, 6379),
    containers: [api, worker, postgres, redisName, object, scheduler],
  });
  const result = {
    passed: true,
    checks: checks.length,
    checkedAt: new Date().toISOString(),
    scope:
      'Isolated real PostgreSQL, Redis, private S3, SMTP, API, delivery, worker, scheduler and trusted HTTPS receiver. Global-shaped IPv4 addresses exist only on a temporary internal Docker bridge; no external webhook message or production network claim.',
    checks,
  };
  writeFileSync('reports/fault-suite.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Fault suite passed ' + checks.length + ' checks.');
} finally {
  for (const name of paused) {
    try {
      command(['unpause', name]);
    } catch {}
  }
  if (db) await db.end().catch(() => {});
  for (const name of names.reverse()) {
    try {
      command(['rm', '-f', name]);
    } catch {}
  }
  if (networkCreated)
    try {
      command(['network', 'rm', network]);
    } catch {}
  for (const file of ['runtime.env', 's3.json', 'secret.txt', 'key.pem'])
    try {
      unlinkSync(dir + '/' + file);
    } catch {}
}
