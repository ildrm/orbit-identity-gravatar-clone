import { beginDeliveryWrite, endDeliveryWrite } from './delivery-cache.js';
import { closeRedis } from './redis.js';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { database, closeDatabase } from './db.js';
const db = await database().connect();
let fenced = false;
try {
  await beginDeliveryWrite();
  fenced = true;
  await db.query('SELECT pg_advisory_lock(718204)');
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir(resolve('migrations')))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
      continue;
    await db.query('BEGIN');
    try {
      await db.query(await readFile(resolve('migrations', name), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      await db.query('COMMIT');
      process.stdout.write('Applied ' + name + '\n');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await db.query('SELECT pg_advisory_unlock(718204)');
  db.release();
  try {
    if (fenced) await endDeliveryWrite();
  } finally {
    await Promise.all([closeDatabase(), closeRedis()]);
  }
}
