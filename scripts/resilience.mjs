import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { Client } from 'pg';
import assert from 'node:assert/strict';
const origin = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Resilience test is restricted to a local Compose stack');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const identityId = 'idn_' + randomBytes(16).toString('hex'),
  accountId = 'acc_' + randomBytes(16).toString('hex'),
  token = randomBytes(32).toString('base64url'),
  handle = 'resilience' + randomBytes(4).toString('hex');
function compose(...args) {
  const result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit' });
  assert.equal(result.status, 0, 'Compose operation ' + args.join(' '));
}
async function until(action) {
  for (let n = 0; n < 60; n++) {
    if (await action()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Recovery timed out');
}
let workerStopped = false,
  redisStopped = false;
try {
  await db.query(
    "INSERT INTO accounts(id,email,password_hash,verified_at) VALUES($1,$2,'non-login-test-fixture',now())",
    [accountId, handle + '@example.test'],
  );
  await db.query("INSERT INTO identities(id,type,handle) VALUES($1,'PERSON',$2)", [
    identityId,
    handle,
  ]);
  await db.query("INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,'OWNER')", [
    identityId,
    accountId,
  ]);
  await db.query(
    "INSERT INTO sessions(id,account_id,digest,device,expires_at) VALUES($1,$2,$3,'Resilience test',now()+interval '1 hour')",
    [
      'ses_' + randomBytes(16).toString('hex'),
      accountId,
      createHash('sha256').update(token).digest('hex'),
    ],
  );
  compose('stop', 'worker');
  workerStopped = true;
  const headers = {
    Origin: origin,
    Cookie: 'identity_session=' + token,
    'Content-Type': 'application/json',
  };
  const created = await fetch(origin + '/api/v1/identities/' + identityId + '/exports', {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(created.status, 201);
  const queued = await created.json();
  assert.equal(
    (await db.query('SELECT status FROM exports WHERE id=$1', [queued.id])).rows[0].status,
    'PENDING',
  );
  compose('start', 'worker');
  workerStopped = false;
  await until(
    async () =>
      (await db.query('SELECT status FROM exports WHERE id=$1', [queued.id])).rows[0]?.status ===
      'READY',
  );
  assert.equal(
    (await fetch(origin + '/api/v1/exports/' + queued.id + '/download', { headers })).status,
    200,
  );
  process.stdout.write(
    'PASS a queued export survives worker downtime and resumes after restart.\n',
  );
  compose('stop', 'redis');
  redisStopped = true;
  const blocked = await fetch(origin + '/api/v1/profiles/' + identityId);
  assert.ok(blocked.status >= 500, 'Redis outage must fail closed');
  const body = await blocked.text();
  assert.ok(!body.includes('password') && !body.includes(process.env.REDIS_PASSWORD));
  assert.equal((await fetch(origin + '/health/ready')).status, 503);
  process.stdout.write('PASS Redis outage blocks requests and readiness.\n');
  compose('start', 'redis');
  redisStopped = false;
  await until(async () => (await fetch(origin + '/health/ready')).status === 200);
  process.stdout.write('PASS Redis recovery restores readiness.\n');
  // Use the normal deletion workflow to clean storage and queue a privacy tombstone.
  assert.equal(
    (
      await fetch(origin + '/api/v1/identities/' + identityId, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ confirmation: handle }),
      })
    ).status,
    200,
  );
} finally {
  if (workerStopped) compose('start', 'worker');
  if (redisStopped) compose('start', 'redis');
  await db.end();
}
