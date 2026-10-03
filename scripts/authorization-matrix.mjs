import { Client } from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const prefix = 'matrix' + randomBytes(5).toString('hex'),
  identityId = 'idn_' + randomBytes(16).toString('hex');
const origin = process.env.PUBLIC_ORIGIN,
  base = process.env.TEST_API_ORIGIN ?? 'http://localhost:4000',
  digest = (t) => createHash('sha256').update(t).digest('hex');
const roles = [
  'OWNER',
  'ADMIN',
  'EDITOR',
  'PROFILE_MANAGER',
  'BRAND_MANAGER',
  'HR_MANAGER',
  'DEVELOPER',
  'AUDITOR',
];
let checks = 0;
const accountIds = [];
try {
  await db.query('INSERT INTO identities(id,type,handle) VALUES($1,$2,$3)', [
    identityId,
    'ORGANIZATION',
    prefix,
  ]);
  await db.query('INSERT INTO handles(handle,identity_id) VALUES($1,$2)', [prefix, identityId]);
  for (const role of roles) {
    const accountId = 'acc_' + randomBytes(16).toString('hex'),
      token = randomBytes(32).toString('base64url');
    accountIds.push(accountId);
    await db.query(
      "INSERT INTO accounts(id,email,password_hash,verified_at) VALUES($1,$2,'test-fixture-not-a-login-hash',now())",
      [accountId, prefix + role.toLowerCase() + '@example.test'],
    );
    await db.query('INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,$3)', [
      identityId,
      accountId,
      role,
    ]);
    await db.query(
      "INSERT INTO sessions(id,account_id,digest,device,expires_at) VALUES($1,$2,$3,'Authorization fixture',now()+interval '1 hour')",
      ['ses_' + randomBytes(16).toString('hex'), accountId, digest(token)],
    );
    const headers = {
      Origin: origin,
      Cookie: 'identity_session=' + token,
      'Content-Type': 'application/json',
    };
    const read = await fetch(base + '/api/v1/identities/' + identityId, { headers });
    assert.equal(read.status, 200, role + ' read');
    checks++;
    const claim = await fetch(base + '/api/v1/identities/' + identityId + '/claims', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        key: 'core:bio',
        value: role,
        policy: {
          visibility: 'PRIVATE',
          searchable: false,
          indexable: false,
          api: false,
          machine: false,
          agent: false,
          applications: [],
          transformation: 'FULL',
        },
      }),
    });
    assert.equal(
      claim.status,
      ['OWNER', 'ADMIN', 'EDITOR', 'PROFILE_MANAGER'].includes(role) ? 200 : 403,
      role + ' claim permission',
    );
    checks++;
    const settings = await fetch(base + '/api/v1/identities/' + identityId + '/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        visibility: 'PRIVATE',
        searchable: false,
        indexable: false,
        machine: false,
        agent: false,
        theme: 'light',
        locale: 'en',
      }),
    });
    assert.equal(settings.status, role === 'OWNER' ? 200 : 403, role + ' security permission');
    checks++;
    const deletion = await fetch(base + '/api/v1/identities/' + identityId, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ confirmation: 'wrong-confirmation' }),
    });
    assert.equal(deletion.status, role === 'OWNER' ? 400 : 403, role + ' deletion permission');
    checks++;
  }
  for (const headers of [
    {},
    { Authorization: 'Bearer invalid-app-token' },
    { Authorization: 'Bearer invalid-service-token' },
  ]) {
    const r = await fetch(base + '/api/v1/identities/' + identityId, { headers });
    assert.equal(r.status, 401);
    checks++;
  }
  process.stdout.write('Authorization matrix checks passed: ' + checks + '\n');
} finally {
  await db.query("DELETE FROM jobs WHERE payload->>'identityId'=$1", [identityId]);
  await db.query('DELETE FROM audit WHERE identity_id=$1', [identityId]);
  await db.query('DELETE FROM revisions WHERE identity_id=$1', [identityId]);
  await db.query('DELETE FROM claims WHERE identity_id=$1', [identityId]);
  await db.query('DELETE FROM handles WHERE identity_id=$1', [identityId]);
  await db.query('DELETE FROM identities WHERE id=$1', [identityId]);
  for (const accountId of accountIds)
    await db.query('DELETE FROM accounts WHERE id=$1', [accountId]);
  await db.end();
}
