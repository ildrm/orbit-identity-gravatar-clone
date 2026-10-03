import { spawn } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { appendFile, mkdir, open, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
const keyValue = process.env.BACKUP_ENCRYPTION_KEY;
if (!keyValue || !/^[a-f0-9]{64}$/i.test(keyValue))
  throw new Error('Set a separate 64-hex BACKUP_ENCRYPTION_KEY');
const key = Buffer.from(keyValue, 'hex'),
  magic = Buffer.from('ORBIT-BACKUP-V1\n');
const mode = process.argv[2] ?? 'create';
if (mode === 'create') {
  const root = resolve('backups');
  await mkdir(root, { recursive: true });
  const filename = resolve(
    root,
    'postgres-' + new Date().toISOString().replace(/[:.]/g, '-') + '.enc',
  );
  if (!filename.startsWith(root + sep)) throw new Error('Unsafe backup destination');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const stream = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
  stream.write(Buffer.concat([magic, iv]));
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
      'identity',
      '--format=custom',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const completion = new Promise((resolveExit, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolveExit() : reject(new Error('pg_dump failed'))));
  });
  try {
    await Promise.all([pipeline(child.stdout, cipher, stream), completion]);
    await appendFile(filename, cipher.getAuthTag());
    process.stdout.write(filename + '\n');
  } catch (error) {
    child.kill();
    throw error;
  }
} else if (mode === 'decrypt') {
  const root = resolve('backups'),
    filename = resolve(process.argv[3] ?? '');
  if (!filename.startsWith(root + sep) || !filename.endsWith('.enc'))
    throw new Error('Use an encrypted file inside backups');
  const file = await open(filename, 'r'),
    length = (await stat(filename)).size;
  const prefix = Buffer.alloc(magic.length + 12),
    tag = Buffer.alloc(16);
  try {
    await file.read(prefix, 0, prefix.length, 0);
    await file.read(tag, 0, 16, length - 16);
  } finally {
    await file.close();
  }
  if (!prefix.subarray(0, magic.length).equals(magic) || length <= prefix.length + 16)
    throw new Error('Invalid backup envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, prefix.subarray(magic.length));
  decipher.setAuthTag(tag);
  // Decryption is streamed to stdout. Restore only into an isolated target first:
  // no production destination or filesystem overwrite is inferred by this script.
  await pipeline(
    createReadStream(filename, { start: prefix.length, end: length - 17 }),
    decipher,
    process.stdout,
  );
} else throw new Error('Use create or decrypt');
