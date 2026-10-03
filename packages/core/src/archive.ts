import { mkdtemp, open, stat, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { getObject, putObjectFile } from './storage.js';
type Entry = { path: string; data?: Buffer; objectKey?: string; maxBytes?: number };
function tarHeader(path: string, size: number): Buffer {
  if (
    !/^[A-Za-z0-9_./-]{1,99}$/.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((p) => p === '..')
  )
    throw new Error('InvalidArchivePath');
  const b = Buffer.alloc(512);
  b.write(path, 0, 100);
  b.write('0000600\0', 100);
  b.write('0000000\0', 108);
  b.write('0000000\0', 116);
  b.write(size.toString(8).padStart(11, '0') + '\0', 124);
  b.write('00000000000\0', 136);
  b.fill(32, 148, 156);
  b.write('0', 156);
  b.write('ustar\0', 257);
  b.write('00', 263);
  const checksum = b.reduce((s, n) => s + n, 0);
  b.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}
export async function uploadArchive(key: string, entries: Entry[]) {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-export-')),
    tarPath = join(directory, 'bundle.tar'),
    gzipPath = join(directory, 'bundle.tar.gz'),
    checksums: { path: string; bytes: number; sha256: string }[] = [];
  let total = 0;
  try {
    const file = await open(tarPath, 'w', 0o600);
    try {
      for (const entry of entries) {
        const data =
          entry.data ?? (await getObject(entry.objectKey!, entry.maxBytes ?? 32 * 1024 * 1024));
        total += data.length;
        if (total > 512 * 1024 * 1024) throw new Error('ExportArchiveLimitExceeded');
        checksums.push({
          path: entry.path,
          bytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
        });
        await file.writeFile(tarHeader(entry.path, data.length));
        await file.writeFile(data);
        const remainder = data.length % 512;
        if (remainder) await file.writeFile(Buffer.alloc(512 - remainder));
      }
      const checksumData = Buffer.from(JSON.stringify(checksums, null, 2));
      await file.writeFile(tarHeader('checksums.json', checksumData.length));
      await file.writeFile(checksumData);
      if (checksumData.length % 512)
        await file.writeFile(Buffer.alloc(512 - (checksumData.length % 512)));
      await file.writeFile(Buffer.alloc(1024));
    } finally {
      await file.close();
    }
    await pipeline(
      createReadStream(tarPath),
      createGzip({ level: 6 }),
      createWriteStream(gzipPath, { mode: 0o600 }),
    );
    await putObjectFile(key, gzipPath, (await stat(gzipPath)).size, 'application/gzip');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
