import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const dockerfile = readFileSync('infrastructure/docker/server.Dockerfile'),
  hash = createHash('sha256').update(dockerfile).digest('hex');
for (const service of ['worker', 'scheduler', 'delivery', 'migrate', 'storage-init'])
  execFileSync('docker', ['image', 'tag', 'identity-platform-api', 'identity-platform-' + service]);
console.log('Tagged the shared server runtime for all six roles; Dockerfile SHA-256 ' + hash + '.');
