import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('reports', { recursive: true });
mkdirSync('data/security-cache', { recursive: true });
const reports = resolve('reports'),
  cache = resolve('data/security-cache'),
  root = process.cwd();
let failed = false;
function run(name, command, args) {
  if (process.platform === 'win32' && command === 'npm.cmd') {
    args = ['/d', '/s', '/c', 'npm.cmd', ...args];
    command = process.env.ComSpec ?? 'cmd.exe';
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 600000,
  });
  writeFileSync(resolve(reports, name + '.stdout.txt'), result.stdout ?? '');
  writeFileSync(
    resolve(reports, name + '.stderr.txt'),
    (result.stderr ?? '') + (result.error?.message ?? ''),
  );
  if (result.status !== 0) {
    failed = true;
    process.stdout.write('FAIL ' + name + ' (inspect redacted report)\n');
  } else process.stdout.write('PASS ' + name + '\n');
  return result;
}
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const audit = run('npm-audit', npmCommand, ['audit', '--json']);
writeFileSync(resolve(reports, 'npm-audit.json'), audit.stdout ?? '');
const sbom = run('sbom', npmCommand, ['sbom', '--sbom-format', 'cyclonedx', '--omit=dev']);
writeFileSync(resolve(reports, 'sbom.cyclonedx.json'), sbom.stdout ?? '');
run('gitleaks', 'docker', [
  'run',
  '--rm',
  '-v',
  root + ':/work:ro',
  '-v',
  reports + ':/reports',
  'zricethezav/gitleaks:v8.30.1',
  'dir',
  '/work',
  '--config',
  '/work/.gitleaks.toml',
  '--redact',
  '--no-banner',
  '--report-format',
  'json',
  '--report-path',
  '/reports/gitleaks.json',
]);
for (const [name, image] of [
  ['api', 'identity-platform-api'],
  ['web', 'identity-platform-web'],
  ['admin', 'identity-platform-admin'],
  ['postgres', 'identity-platform-postgres'],
  [
    'redis',
    'redis:8.10.2-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0',
  ],
  [
    'storage',
    'chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d',
  ],
  ['proxy', 'identity-platform-proxy'],
  ['tls', 'identity-platform-tls'],
])
  run('trivy-' + name, 'docker', [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    cache + ':/root/.cache/trivy',
    '-v',
    reports + ':/reports',
    'aquasec/trivy:0.75.0',
    'image',
    '--db-repository',
    'ghcr.io/aquasecurity/trivy-db:2',
    '--scanners',
    'vuln',
    '--severity',
    'HIGH,CRITICAL',
    '--exit-code',
    '1',
    '--format',
    'json',
    '--output',
    '/reports/trivy-' + name + '.json',
    image,
  ]);
writeFileSync(
  resolve(reports, 'security-summary.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      passed: !failed,
      scope:
        'npm dependency audit, production SBOM, source secret scan, application and production infrastructure image HIGH/CRITICAL vulnerabilities',
    },
    null,
    2,
  ),
);
process.exitCode = failed ? 1 : 0;
