import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('reports', { recursive: true });
for (const name of ['sdk', 'ui']) {
  const args = [
    'pack',
    '--workspace',
    '@orbit-identity/' + name,
    '--pack-destination',
    'reports',
    '--json',
  ];
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], {
          encoding: 'utf8',
        })
      : spawnSync('npm', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [metadata] = JSON.parse(result.stdout);
  assert.ok(metadata.files.some((f) => f.path === 'dist/index.js'));
  assert.ok(metadata.files.some((f) => f.path === 'dist/index.d.ts'));
  assert.ok(
    metadata.files.every((f) => !/(^|\/)(\.env|node_modules|reports|data)(\/|$)/.test(f.path)),
  );
  const spec = JSON.parse(
    readFileSync(
      'packages/' + (name === 'sdk' ? 'sdk-typescript' : 'ui') + '/package.json',
      'utf8',
    ),
  );
  assert.equal(spec.private, undefined);
  console.log(
    'PASS installable @orbit-identity/' +
      name +
      ' package: ' +
      metadata.files.length +
      ' files, JavaScript and types.',
  );
}
