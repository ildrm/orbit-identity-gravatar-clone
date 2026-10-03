import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const name = 'orbit-postgres-check-' + randomBytes(8).toString('hex');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Docker command failed');
  return result.stdout;
}
let started = false;
try {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    'none',
    '--tmpfs',
    '/var/lib/postgresql',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    'identity-platform-postgres',
  ]);
  started = true;
  let ready = false;
  for (let n = 0; n < 120; n++) {
    const probe = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Clean PostgreSQL image initialization');
  const expectedUid = docker(['exec', name, 'id', '-u', 'postgres']).trim();
  const status = docker(['exec', name, 'cat', '/proc/1/status']);
  assert.equal(status.match(/^Uid:\s+(\d+)/m)?.[1], expectedUid, 'PID 1 runs as the postgres user');
  assert.notEqual(expectedUid, '0');
  assert.equal(docker(['exec', name, 'psql', '-U', 'postgres', '-Atc', 'SELECT 42']).trim(), '42');
  console.log(
    'Patched PostgreSQL image: clean initialization, non-root PID 1 and actual SQL passed.',
  );
} finally {
  if (started) docker(['rm', '-f', name]);
}
