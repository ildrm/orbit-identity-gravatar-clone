import { readdirSync } from 'node:fs';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const name = 'migration_' + randomBytes(8).toString('hex');
if (!/^migration_[a-f0-9]{16}$/.test(name)) throw new Error('Unsafe migration target');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let created = false;
try {
  await db.query('CREATE DATABASE "' + name + '"');
  created = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + name;
  for (let pass = 0; pass < 2; pass++) {
    const result = spawnSync(process.execPath, ['dist/packages/core/src/migrate.js'], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
    assert.equal(result.status, 0, 'Clean migration/idempotent rerun');
  }
  const clean = new Client({ connectionString: url.toString() });
  await clean.connect();
  try {
    const migrations = await clean.query('SELECT name FROM schema_migrations ORDER BY name');
    assert.equal(
      migrations.rowCount,
      readdirSync('migrations').filter((name) => name.endsWith('.sql')).length,
    );
    const columns = await clean.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='identities'",
    );
    assert.ok(columns.rows.some((row) => row.column_name === 'contact_enabled'));
    let constraintsRejected = 0;
    for (const values of [
      ['invalid', 'PERSON', 'ValidHandle'],
      ['valid', 'ALIEN', 'valid_handle'],
    ]) {
      await assert.rejects(
        clean.query('INSERT INTO identities(id,type,handle) VALUES($1,$2,$3)', values),
      );
      constraintsRejected++;
    }
    await clean.query(
      "INSERT INTO identities(id,type,handle) VALUES('identity_a','PERSON','identity_a'),('identity_b','PERSON','identity_b')",
    );
    await clean.query(
      "INSERT INTO media(id,identity_id,source_key,alt) VALUES('media_a','identity_a','test/source','Fixture')",
    );
    await assert.rejects(
      clean.query("UPDATE identities SET avatar_media_id='media_a' WHERE id='identity_b'"),
    );
    constraintsRejected++;
    process.stdout.write(
      'Clean migrations, idempotent rerun and ' +
        constraintsRejected +
        ' invalid data constraints passed.\n',
    );
  } finally {
    await clean.end();
  }
} finally {
  if (created) await db.query('DROP DATABASE "' + name + '"');
  await db.end();
}
