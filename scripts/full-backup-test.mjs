import { randomBytes, createHash } from 'node:crypto';
import { Client } from 'pg';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const { createFull, restoreFull } = await import('./full-backup.mjs'),
  { storage } = await import('../dist/packages/core/src/storage.js'),
  sourceSuffix = randomBytes(8).toString('hex'),
  targetSuffix = randomBytes(8).toString('hex'),
  invalidSuffix = randomBytes(8).toString('hex'),
  source = 'restore_' + sourceSuffix,
  target = 'recovery_' + targetSuffix,
  sourceBucket = 'orbit-restore-' + sourceSuffix,
  targetBucket = 'orbit-restore-' + targetSuffix;
const admin = new Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
let sourceCreated = false,
  targetCreated = false,
  sourceBucketCreated = false,
  targetBucketCreated = false,
  filename,
  badfile;
try {
  await admin.query('CREATE DATABASE "' + source + '"');
  sourceCreated = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + source;
  const migration = spawnSync(process.execPath, ['dist/packages/core/src/migrate.js'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8',
  });
  assert.equal(migration.status, 0, migration.stderr);
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const account = 'acc_' + randomBytes(16).toString('hex'),
    identity = 'idn_' + randomBytes(16).toString('hex'),
    media = 'med_' + randomBytes(16).toString('hex'),
    objectKey = 'validated/' + identity + '/' + media + '.png',
    secretCanary = 'private-backup-fixture-' + randomBytes(32).toString('hex'),
    content = Buffer.concat([Buffer.from(secretCanary), randomBytes(1024 * 1024)]);
  try {
    await db.query(
      "INSERT INTO accounts(id,email,password_hash,verified_at)VALUES($1,'recovery@example.test','DISABLED',now())",
      [account],
    );
    await db.query("INSERT INTO identities(id,type,handle)VALUES($1,'PERSON',$2)", [
      identity,
      'recovery' + sourceSuffix,
    ]);
    await db.query("INSERT INTO memberships(identity_id,account_id,role)VALUES($1,$2,'OWNER')", [
      identity,
      account,
    ]);
    await db.query(
      "INSERT INTO media(id,identity_id,source_key,status,bytes,alt)VALUES($1,$2,$3,'READY',$4,'Private restored media')",
      [media, identity, objectKey, content.length],
    );
  } finally {
    await db.end();
  }
  await storage().send(new CreateBucketCommand({ Bucket: sourceBucket }));
  sourceBucketCreated = true;
  await storage().send(
    new PutObjectCommand({
      Bucket: sourceBucket,
      Key: objectKey,
      Body: content,
      ContentType: 'image/png',
    }),
  );
  filename = await createFull({ databaseName: source, bucket: sourceBucket, maintenance: true });
  const encrypted = await readFile(filename);
  assert.ok(!encrypted.includes(Buffer.from(secretCanary)));
  assert.ok(!encrypted.includes(Buffer.from('PGDMP')));
  const result = await restoreFull({ filename, databaseName: target, bucket: targetBucket });
  targetCreated = true;
  targetBucketCreated = true;
  assert.equal(result.objects, 1);
  url.pathname = '/' + target;
  const restored = new Client({ connectionString: url.toString() });
  await restored.connect();
  try {
    assert.equal(
      (await restored.query('SELECT source_key FROM media WHERE id=$1', [media])).rows[0]
        .source_key,
      objectKey,
    );
    assert.equal(
      (await restored.query('SELECT count(*) FROM schema_migrations')).rows[0].count,
      String((await readdir('migrations')).filter((name) => name.endsWith('.sql')).length),
    );
  } finally {
    await restored.end();
  }
  const object = await storage().send(
      new GetObjectCommand({ Bucket: targetBucket, Key: objectKey }),
    ),
    actual = Buffer.from(await object.Body.transformToByteArray());
  assert.equal(
    createHash('sha256').update(actual).digest('hex'),
    createHash('sha256').update(content).digest('hex'),
  );
  badfile = filename.replace('.enc', '-tampered.enc');
  encrypted[encrypted.length - 1] ^= 1;
  await writeFile(badfile, encrypted, { mode: 0o600 });
  await assert.rejects(
    restoreFull({
      filename: badfile,
      databaseName: 'restore_' + invalidSuffix,
      bucket: 'orbit-restore-' + invalidSuffix,
    }),
  );
  assert.equal(
    (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', ['restore_' + invalidSuffix]))
      .rowCount,
    0,
  );
  await assert.rejects(
    restoreFull({ filename, databaseName: 'identity', bucket: process.env.S3_BUCKET }),
    /isolated/,
  );
  await mkdir('reports', { recursive: true });
  await writeFile(
    'reports/full-backup-restore.json',
    JSON.stringify(
      {
        kind: 'isolated-encrypted-database-and-object-restore',
        objects: 1,
        migrations: (await readdir('migrations')).filter((name) => name.endsWith('.sql')).length,
        sha256Verified: true,
        tamperingRejectedBeforeWrites: true,
        productionTargetRejected: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS encrypted PostgreSQL + private object restore, checksums, authentication-before-write, and production-target refusal.',
  );
} finally {
  for (const [bucket, created] of [
    [sourceBucket, sourceBucketCreated],
    [targetBucket, targetBucketCreated],
  ])
    if (created) {
      const list = await storage().send(new ListObjectsV2Command({ Bucket: bucket }));
      for (const o of list.Contents ?? [])
        await storage().send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key }));
      await storage().send(new DeleteBucketCommand({ Bucket: bucket }));
    }
  if (targetCreated) await admin.query('DROP DATABASE "' + target + '"');
  if (sourceCreated) await admin.query('DROP DATABASE "' + source + '"');
  await admin.end();
  if (filename) await rm(filename, { force: true });
  if (badfile) await rm(badfile, { force: true });
}
