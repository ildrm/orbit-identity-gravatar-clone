import { Client } from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { request, Agent } from 'node:https';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const suffix = randomBytes(8).toString('hex'),
  container = 'orbit-tls-' + suffix,
  identityId = 'idn_' + randomBytes(16).toString('hex'),
  domainId = 'dom_' + randomBytes(16).toString('hex'),
  claimId = 'clm_' + randomBytes(16).toString('hex'),
  domain = 'tls-' + suffix + '.example.test',
  handle = 'tls' + suffix;
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
mkdirSync('reports', { recursive: true });
const configPath = resolve('reports/tls-rehearsal-' + suffix + '.Caddyfile'),
  rootPath = resolve('reports/tls-root-' + suffix + '.crt');
let started = false,
  checks = 0;
function command(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, 'TLS fixture command failed: ' + (r.stderr ?? ''));
  return r.stdout.trim();
}
function check(condition, description) {
  assert.ok(condition, description);
  checks++;
  console.log('PASS ' + description);
}
function https(port, servername, host = servername, ca) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/',
        servername,
        headers: { Host: host },
        agent: new Agent({ ca, proxyEnv: {} }),
        ca,
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('TLS request timed out')));
    req.end();
  });
}
try {
  await db.query(
    "INSERT INTO identities(id,type,handle,visibility,machine) VALUES($1,'PERSON',$2,'PUBLIC',true)",
    [identityId, handle],
  );
  await db.query('INSERT INTO handles(handle,identity_id) VALUES($1,$2)', [handle, identityId]);
  const policy = {
    visibility: 'PUBLIC',
    searchable: false,
    indexable: false,
    api: true,
    machine: true,
    agent: false,
    applications: [],
    transformation: 'FULL',
  };
  await db.query(
    "INSERT INTO claims(id,identity_id,key,value,policy) VALUES($1,$2,'core:display_name',$3,$4)",
    [claimId, identityId, JSON.stringify('TLS routing fixture'), JSON.stringify(policy)],
  );
  await db.query(
    "INSERT INTO domains(id,identity_id,domain,challenge_digest,challenge_value,verified_at,last_checked_at,expires_at,custom_enabled,canonical,routing_state) VALUES($1,$2,$3,$4,$5,now(),now(),now()+interval '1 day',true,true,'ACTIVE')",
    [domainId, identityId, domain, createHash('sha256').update(suffix).digest('hex'), suffix],
  );
  writeFileSync(
    configPath,
    '{\n admin off\n on_demand_tls {\n  ask http://api:4000/internal/custom-domains/authorize\n }\n}\n:443 {\n tls internal {\n  on_demand\n }\n header Strict-Transport-Security "max-age=31536000"\n reverse_proxy reverse-proxy:80\n}\n',
  );
  command([
    'run',
    '--rm',
    '--network',
    'identity-platform_default',
    '-v',
    configPath + ':/etc/caddy/Caddyfile:ro',
    'identity-platform-tls',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
  check(true, 'TLS edge configuration validates with on-demand authorization');
  command([
    'run',
    '--rm',
    '-d',
    '--name',
    container,
    '--network',
    'identity-platform_default',
    '--network-alias',
    'tls-edge',
    '-p',
    '127.0.0.1::443',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/data:uid=10001,gid=10001',
    '--tmpfs',
    '/config:uid=10001,gid=10001',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges:true',
    '-v',
    configPath + ':/etc/caddy/Caddyfile:ro',
    'identity-platform-tls',
  ]);
  started = true;
  const port = Number(command(['port', container, '443/tcp']).match(/127\.0\.0\.1:(\d+)/)?.[1]);
  assert.ok(port);
  for (let n = 0; n < 60; n++) {
    try {
      await https(port, domain);
    } catch (e) {
      if (
        [
          'SELF_SIGNED_CERT_IN_CHAIN',
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
          'DEPTH_ZERO_SELF_SIGNED_CERT',
        ].includes(e.code)
      )
        break;
      if (n === 59) throw e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  writeFileSync(
    rootPath,
    command(['exec', container, 'cat', '/data/caddy/pki/authorities/local/root.crt']) + '\n',
  );
  const ca = readFileSync(rootPath),
    page = await https(port, domain, domain, ca);
  check(
    page.status === 200 && page.body.includes('TLS routing fixture'),
    'Trusted HTTPS serves the verified custom-domain profile',
  );
  check(page.body.includes('https://' + domain), 'Custom-domain canonical URL is present in SSR');
  check(
    typeof page.headers['content-security-policy'] === 'string',
    'Custom-domain profile retains its content security policy',
  );
  check(
    /max-age=(\d+)/.test(String(page.headers['strict-transport-security'])) &&
      Number(String(page.headers['strict-transport-security']).match(/max-age=(\d+)/)?.[1]) >=
        31536000,
    'Custom-domain HTTPS sends HSTS',
  );
  const wrongHost = await https(port, domain, 'unknown-' + suffix + '.example.test', ca);
  check(wrongHost.status === 404, 'A mismatched HTTP host cannot use another domain mapping');
  await assert.rejects(https(port, 'unauthorized-' + suffix + '.example.test', undefined, ca));
  check(true, 'An unknown SNI name cannot obtain an on-demand certificate');
  const unauthorized = await fetch(
    (process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080') +
      '/internal/custom-domains/authorize?domain=' +
      domain,
  );
  check(
    unauthorized.status === 404,
    'Public callers cannot access the internal TLS authorization endpoint',
  );
  await db.query(
    "UPDATE domains SET revoked_at=now(),custom_enabled=false,routing_state='DISABLED' WHERE id=$1",
    [domainId],
  );
  check(
    (await https(port, domain, domain, ca)).status === 404,
    'Removing domain ownership immediately denies routing despite a cached certificate',
  );
  writeFileSync(
    'reports/tls-rehearsal.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: true,
        checks,
        scope:
          'Actual trusted local HTTPS with an isolated Caddy internal CA; synthetic current domain proof fixture. Public DNS and ACME issuance require deployment DNS.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('TLS rehearsal passed ' + checks + ' checks.');
} finally {
  if (started) {
    const log = spawnSync('docker', ['logs', container], { encoding: 'utf8' });
    writeFileSync('reports/tls-edge.log', (log.stdout ?? '') + (log.stderr ?? ''));
    const files = spawnSync(
      'docker',
      ['exec', container, 'find', '/data', '/config', '-type', 'f'],
      { encoding: 'utf8' },
    );
    writeFileSync('reports/tls-files.log', (files.stdout ?? '') + (files.stderr ?? ''));
    command(['rm', '-f', container]);
  }
  await db.query('DELETE FROM domains WHERE id=$1', [domainId]);
  await db.query('DELETE FROM claims WHERE id=$1', [claimId]);
  await db.query('DELETE FROM handles WHERE identity_id=$1', [identityId]);
  await db.query('DELETE FROM identities WHERE id=$1', [identityId]);
  await db.end();
  for (const file of [configPath, rootPath]) rmSync(file, { force: true });
}
