import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import assert from 'node:assert/strict';
const env = { ...process.env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const made = spawnSync(process.execPath, ['scripts/backup.mjs', 'create'], {
  env,
  encoding: 'utf8',
});
assert.equal(made.status, 0, made.stderr);
const path = made.stdout.trim();
try {
  const raw = readFileSync(path);
  assert.ok(raw.subarray(0, 15).toString().startsWith('ORBIT-BACKUP'));
  assert.ok(
    !raw.includes(Buffer.from('PGDMP')),
    'PostgreSQL plaintext must not appear in encrypted archive',
  );
  const decoded = spawnSync(process.execPath, ['scripts/backup.mjs', 'decrypt', path], {
    env,
    maxBuffer: 100 * 1024 * 1024,
  });
  assert.equal(decoded.status, 0);
  assert.equal(decoded.stdout.subarray(0, 5).toString(), 'PGDMP');
  const wrong = spawnSync(process.execPath, ['scripts/backup.mjs', 'decrypt', path], {
    env: { ...env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex') },
    maxBuffer: 100 * 1024 * 1024,
  });
  assert.notEqual(wrong.status, 0, 'Wrong key must fail authenticated decryption');
  process.stdout.write('Encrypted PostgreSQL archive round-trip and wrong-key rejection passed.\n');
} finally {
  unlinkSync(path);
}
