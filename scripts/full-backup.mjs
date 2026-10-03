import { spawn } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, open, appendFile, stat, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { Client } from 'pg';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { storage } from '../dist/packages/core/src/storage.js';
const keyValue = process.env.BACKUP_ENCRYPTION_KEY;
if (!/^[a-f0-9]{64}$/i.test(keyValue ?? ''))
  throw new Error('Set the separate 64-hex BACKUP_ENCRYPTION_KEY.');
const key = Buffer.from(keyValue, 'hex'),
  magic = Buffer.from('ORBIT-FULL-BACKUP-V2\n'),
  root = resolve('backups'),
  maxBytes = 100 * 1024 ** 3;
async function runDump(name, destination) {
  const child = spawn(
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
      name,
      '--format=custom',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const complete = new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('exit', (c) => (c === 0 ? ok() : fail(new Error('Database dump failed.'))));
  });
  await Promise.all([
    pipeline(child.stdout, createWriteStream(destination, { flags: 'wx', mode: 0o600 })),
    complete,
  ]);
}
async function* fileRecords(name, keyName, source, contentType) {
  yield JSON.stringify({ kind: 'start', name, key: keyName, contentType }) + '\n';
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const value of source) {
    const b = Buffer.from(value);
    for (let at = 0; at < b.length; at += 64 * 1024) {
      const chunk = b.subarray(at, at + 64 * 1024);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Backup size limit exceeded.');
      hash.update(chunk);
      yield JSON.stringify({ kind: 'chunk', data: chunk.toString('base64') }) + '\n';
    }
  }
  yield JSON.stringify({ kind: 'end', bytes, sha256: hash.digest('hex') }) + '\n';
}
async function* boundedLines(filename) {
  let remaining = '';
  for await (const chunk of createReadStream(filename, {
    encoding: 'utf8',
    highWaterMark: 64 * 1024,
  })) {
    remaining += chunk;
    if (remaining.length > 256 * 1024) throw new Error('Backup record too large.');
    let at;
    while ((at = remaining.indexOf('\n')) >= 0) {
      yield remaining.slice(0, at);
      remaining = remaining.slice(at + 1);
    }
  }
  if (remaining) throw new Error('Truncated backup record.');
}
export async function createFull({ databaseName, bucket, maintenance = false } = {}) {
  if (!maintenance)
    throw new Error(
      'Create requires explicit maintenance mode. Stop API, worker and scheduler writes first.',
    );
  databaseName ??= decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  bucket ??= process.env.S3_BUCKET;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName) || !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(bucket))
    throw new Error('Invalid backup source.');
  await mkdir(root, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'orbit-full-backup-')),
    filename = join(
      root,
      'full-' +
        new Date().toISOString().replace(/[:.]/g, '-') +
        '-' +
        randomBytes(4).toString('hex') +
        '.enc',
    );
  try {
    const dump = join(work, 'database.dump');
    await runDump(databaseName, dump);
    async function* records() {
      yield JSON.stringify({
        kind: 'manifest',
        version: 2,
        databaseName,
        bucket,
        createdAt: new Date().toISOString(),
      }) + '\n';
      yield* fileRecords('database', null, createReadStream(dump), null);
      let token,
        total = (await stat(dump)).size;
      do {
        const page = await storage().send(
          new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
        );
        for (const o of page.Contents ?? []) {
          if (!o.Key) continue;
          total += Number(o.Size ?? 0);
          if (total > maxBytes) throw new Error('Backup total size limit exceeded.');
          const object = await storage().send(new GetObjectCommand({ Bucket: bucket, Key: o.Key }));
          if (!object.Body) throw new Error('Storage object missing during backup.');
          yield* fileRecords(
            'object',
            o.Key,
            object.Body,
            object.ContentType ?? 'application/octet-stream',
          );
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      yield JSON.stringify({ kind: 'complete' }) + '\n';
    }
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    await appendFile(filename, Buffer.concat([magic, iv]), { flag: 'wx', mode: 0o600 });
    try {
      await pipeline(
        Readable.from(records()),
        createGzip({ level: 6 }),
        cipher,
        createWriteStream(filename, { flags: 'a', mode: 0o600 }),
      );
      await appendFile(filename, cipher.getAuthTag());
      return filename;
    } catch (e) {
      await rm(filename, { force: true });
      throw e;
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
export async function restoreFull({ filename, databaseName, bucket }) {
  const absolute = resolve(filename);
  if (!absolute.startsWith(root + sep) || !absolute.endsWith('.enc'))
    throw new Error('Use an encrypted archive inside backups.');
  if (
    !/^(restore|recovery)_[a-f0-9]{16}$/.test(databaseName) ||
    !/^orbit-restore-[a-f0-9]{16}$/.test(bucket)
  )
    throw new Error(
      'Restore requires new isolated restore/recovery database and orbit-restore bucket names.',
    );
  const work = await mkdtemp(join(tmpdir(), 'orbit-full-restore-')),
    decoded = join(work, 'verified.ndjson'),
    file = await open(absolute, 'r'),
    size = (await stat(absolute)).size,
    prefix = Buffer.alloc(magic.length + 12),
    tag = Buffer.alloc(16);
  try {
    await file.read(prefix, 0, prefix.length, 0);
    await file.read(tag, 0, tag.length, size - tag.length);
  } finally {
    await file.close();
  }
  let dbCreated = false,
    bucketCreated = false;
  const admin = new Client({ connectionString: process.env.DATABASE_URL }),
    keys = [],
    handles = new Set();
  try {
    if (
      size <= prefix.length + tag.length ||
      size > maxBytes ||
      !prefix.subarray(0, magic.length).equals(magic)
    )
      throw new Error('Invalid backup envelope.');
    const decipher = createDecipheriv('aes-256-gcm', key, prefix.subarray(magic.length));
    decipher.setAuthTag(tag);
    // Authentication completes before any database or storage mutation.
    let decodedBytes = 0;
    const unzip = createGunzip();
    unzip.on('data', (b) => {
      decodedBytes += b.length;
      if (decodedBytes > maxBytes) unzip.destroy(new Error('Decompressed backup exceeds limit.'));
    });
    await pipeline(
      createReadStream(absolute, { start: prefix.length, end: size - 17 }),
      decipher,
      unzip,
      createWriteStream(decoded, { flags: 'wx', mode: 0o600 }),
    );
    const entries = [];
    let current = null,
      manifest = false,
      complete = false,
      sequence = 0;
    for await (const line of boundedLines(decoded)) {
      const r = JSON.parse(line);
      if (complete) throw new Error('Trailing backup data.');
      if (r.kind === 'manifest') {
        if (manifest || r.version !== 2) throw new Error('Invalid manifest.');
        manifest = true;
        continue;
      }
      if (!manifest) throw new Error('Missing manifest.');
      if (r.kind === 'start') {
        if (
          current ||
          !['database', 'object'].includes(r.name) ||
          entries.some((e) => e.key === r.key && e.name === r.name) ||
          (typeof r.contentType !== 'string' && r.name !== 'database')
        )
          throw new Error('Invalid file sequence.');
        if (
          r.name === 'object' &&
          (typeof r.key !== 'string' || r.key.length > 1024 || r.key.includes('\0'))
        )
          throw new Error('Invalid object key.');
        current = {
          name: r.name,
          key: r.key,
          contentType: r.contentType,
          path: join(work, 'entry-' + sequence++),
          hash: createHash('sha256'),
          bytes: 0,
          file: null,
        };
        current.file = await open(current.path, 'wx', 0o600);
        handles.add(current.file);
      } else if (r.kind === 'chunk') {
        if (
          !current ||
          typeof r.data !== 'string' ||
          r.data.length > 90_000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(r.data)
        )
          throw new Error('Invalid file chunk.');
        const body = Buffer.from(r.data, 'base64');
        current.bytes += body.length;
        current.hash.update(body);
        await current.file.writeFile(body);
      } else if (r.kind === 'end') {
        if (!current) throw new Error('Unexpected file end.');
        await current.file.close();
        handles.delete(current.file);
        current.file = null;
        if (current.bytes !== r.bytes || current.hash.digest('hex') !== r.sha256)
          throw new Error('Checksum verification failed.');
        entries.push({ ...current, hash: undefined, sha256: r.sha256 });
        current = null;
      } else if (r.kind === 'complete') {
        if (current || !entries.some((e) => e.name === 'database'))
          throw new Error('Incomplete archive.');
        complete = true;
      } else throw new Error('Unknown archive record.');
    }
    if (!complete) throw new Error('Archive has no completion record.');
    await admin.connect();
    await admin.query('CREATE DATABASE "' + databaseName + '"');
    dbCreated = true;
    await storage().send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    for (const entry of entries.filter((e) => e.name === 'object')) {
      await storage().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: entry.key,
          Body: createReadStream(entry.path),
          ContentLength: entry.bytes,
          ContentType: entry.contentType,
        }),
      );
      keys.push(entry.key);
    }
    const dump = entries.find((e) => e.name === 'database'),
      child = spawn(
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
          databaseName,
          '--exit-on-error',
          '--no-owner',
        ],
        { stdio: ['pipe', 'ignore', 'inherit'] },
      ),
      done = new Promise((ok, fail) => {
        child.once('error', fail);
        child.once('exit', (c) => (c === 0 ? ok() : fail(new Error('Isolated restore failed.'))));
      });
    await Promise.all([pipeline(createReadStream(dump.path), child.stdin), done]);
    return {
      databaseName,
      bucket,
      objects: keys.length,
      checksums: entries.map((e) => ({
        name: e.name,
        key: e.key,
        bytes: e.bytes,
        sha256: e.sha256,
      })),
    };
  } catch (e) {
    if (bucketCreated) {
      for (const k of keys)
        await storage().send(new DeleteObjectCommand({ Bucket: bucket, Key: k }));
      await storage().send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    if (dbCreated) await admin.query('DROP DATABASE "' + databaseName + '"');
    throw e;
  } finally {
    for (const handle of handles) await handle.close();
    await admin.end().catch(() => {});
    await rm(work, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2];
  if (mode === 'create')
    console.log(await createFull({ maintenance: process.argv.includes('--maintenance') }));
  else if (mode === 'restore')
    console.log(
      JSON.stringify(
        await restoreFull({
          filename: process.argv[3],
          databaseName: process.argv[4],
          bucket: process.argv[5],
        }),
      ),
    );
  else
    throw new Error('Use create --maintenance or restore ARCHIVE restore_HEX orbit-restore-HEX.');
}
