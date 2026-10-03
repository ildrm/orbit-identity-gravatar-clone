import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from 'pg';
const url = new URL(process.env.DATABASE_URL),
  name = 'restore_' + randomBytes(8).toString('hex');
if (!/^restore_[a-f0-9]{16}$/.test(name)) throw new Error('Unsafe restore target');
const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
let created = false;
try {
  const original = await admin.query('SELECT count(*) AS n FROM identities');
  const dump = execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      'identity',
      '-d',
      'identity',
      '--format=custom',
    ],
    { maxBuffer: 100 * 1024 * 1024 },
  );
  await admin.query('CREATE DATABASE "' + name + '"');
  created = true;
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '-U',
      'identity',
      '-d',
      name,
      '--exit-on-error',
      '--no-owner',
    ],
    { input: dump, maxBuffer: 10 * 1024 * 1024 },
  );
  url.pathname = '/' + name;
  const restored = new Client({ connectionString: url.toString() });
  await restored.connect();
  try {
    const result = await restored.query('SELECT count(*) AS n FROM identities');
    assert.equal(result.rows[0].n, original.rows[0].n);
    assert.ok((await restored.query('SELECT 1 FROM schema_migrations')).rowCount > 0);
    process.stdout.write(
      'Backup restored into isolated database; identity count and migrations verified.\n',
    );
  } finally {
    await restored.end();
  }
} finally {
  if (created) await admin.query('DROP DATABASE "' + name + '"');
  await admin.end();
}
