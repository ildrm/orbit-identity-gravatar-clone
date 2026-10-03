import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const ps = spawnSync('docker', ['compose', 'ps', '--format', 'json'], { encoding: 'utf8' });
if (ps.status !== 0) throw new Error(ps.stderr);
for (const line of ps.stdout.trim().split('\n')) {
  const item = JSON.parse(line);
  console.log(item.Service, item.State, item.Health);
}
const result = spawnSync(
  'docker',
  ['image', 'inspect', 'identity-platform-api', '--format', '{{.Created}} {{.Id}}'],
  { encoding: 'utf8' },
);
console.log('API image', result.stdout.trim());
const ledger = readFileSync('docs/product/feature-matrix.csv', 'utf8').split('\n');
for (const row of ledger)
  if (row.includes('Not implemented')) console.log(row.split(',').slice(0, 3).join(' | '));
