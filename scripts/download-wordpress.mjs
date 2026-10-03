import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const version = '7.1.2';
mkdirSync('reports/wordpress', { recursive: true });
const response = await fetch('https://wordpress.org/wordpress-' + version + '.zip', {
  signal: AbortSignal.timeout(180_000),
});
if (!response.ok) throw Error('WordPress download failed: ' + response.status);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 1_000_000 || bytes.length > 100_000_000)
  throw Error('Unexpected WordPress archive size');
writeFileSync('reports/wordpress/core.zip', bytes);
writeFileSync(
  'reports/wordpress/download.json',
  JSON.stringify(
    {
      version,
      url: response.url,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    },
    null,
    2,
  ) + '\n',
);
console.log('Downloaded official WordPress ' + version + ' archive (' + bytes.length + ' bytes).');
