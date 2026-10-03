import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
assert.match(version, /^\d+\.\d+\.\d+$/);
const reportFiles = [
  'security-summary',
  'fault-suite',
  'performance',
  'wordpress-runtime',
  'tls-rehearsal',
  'openapi-contracts',
];
const evidence = reportFiles.map((name) => {
  const path = 'reports/' + name + '.json',
    bytes = readFileSync(path),
    data = JSON.parse(bytes);
  assert.equal(data.passed, true, 'Release gate must pass: ' + name);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const restorePath = 'reports/full-backup-restore.json',
  restoreBytes = readFileSync(restorePath),
  restore = JSON.parse(restoreBytes);
for (const flag of ['sha256Verified', 'tamperingRejectedBeforeWrites', 'productionTargetRejected'])
  assert.equal(restore[flag], true, 'Full restore gate: ' + flag);
assert.equal(
  restore.migrations,
  readdirSync('migrations').filter((p) => p.endsWith('.sql')).length,
  'Full restore includes every migration',
);
evidence.push({
  path: restorePath,
  sha256: createHash('sha256').update(restoreBytes).digest('hex'),
});
const browserPath = 'reports/e2e.json',
  browserBytes = readFileSync(browserPath),
  browser = JSON.parse(browserBytes);
assert.equal(browser.stats.expected, 3, 'All three browser journeys must pass');
for (const field of ['unexpected', 'flaky', 'skipped'])
  assert.equal(browser.stats[field], 0, 'Browser gate: ' + field);
evidence.push({
  path: browserPath,
  sha256: createHash('sha256').update(browserBytes).digest('hex'),
});
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter(Boolean)
  .filter(
    (p) =>
      !p.startsWith('docs/operations/image-manifest') &&
      !p.startsWith('docs/operations/release-manifest'),
  )
  .sort();
const hash = createHash('sha256');
for (const p of files)
  hash
    .update(p + '\0')
    .update(readFileSync(p))
    .update('\0');
const sourceHash = hash.digest('hex'),
  tag = version + '-' + sourceHash.slice(0, 12),
  manifest = JSON.parse(readFileSync('docs/operations/image-manifest.json', 'utf8'));
const services = {
    api: 'api',
    worker: 'api',
    scheduler: 'api',
    delivery: 'api',
    migrate: 'api',
    'storage-init': 'api',
    web: 'web',
    admin: 'admin',
    postgres: 'postgres',
    'reverse-proxy': 'proxy',
    'tls-edge': 'tls',
    redis: 'redis',
    'object-storage': 'storage',
  },
  overlay = { services: {} },
  tlsOverlay = { services: {} },
  images = [];
for (const [service, scanned] of Object.entries(services)) {
  const entry = manifest.images.find((i) => i.service === scanned);
  assert.ok(entry && entry.highCriticalFindings === 0);
  const original =
    service === 'redis' || service === 'object-storage'
      ? entry.image
      : service === 'reverse-proxy'
        ? 'identity-platform-proxy'
        : service === 'tls-edge'
          ? 'identity-platform-tls'
          : 'identity-platform-' + service;
  const actual = JSON.parse(
    execFileSync('docker', ['image', 'inspect', original], { encoding: 'utf8' }),
  )[0];
  assert.equal(
    actual.Id,
    entry.imageId,
    'Current runtime image must equal the scanned image for ' + service,
  );
  const immutable = 'orbit-identity/' + service + ':' + tag;
  try {
    const existing = JSON.parse(
      execFileSync('docker', ['image', 'inspect', immutable], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )[0];
    assert.equal(
      existing.Id,
      actual.Id,
      'A prepared release tag cannot be overwritten with different content',
    );
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    execFileSync('docker', ['image', 'tag', original, immutable]);
  }
  (service === 'tls-edge' ? tlsOverlay : overlay).services[service] = {
    image: immutable,
    pull_policy: 'never',
  };
  images.push({ service, tag: immutable, imageId: actual.Id });
}
mkdirSync('reports/release', { recursive: true });
writeFileSync('reports/release/compose.release.json', JSON.stringify(overlay, null, 2) + '\n');
writeFileSync(
  'reports/release/compose.tls.release.json',
  JSON.stringify(tlsOverlay, null, 2) + '\n',
);
writeFileSync(
  'docs/operations/release-manifest.json',
  JSON.stringify(
    {
      preparedAt: new Date().toISOString(),
      version,
      sourceHash,
      evidence,
      scope:
        'Prepared immutable local image tags. No registry publication, external deployment or signing has been performed.',
      images,
    },
    null,
    2,
  ) + '\n',
);
console.log('Prepared immutable local release ' + tag + ' with scan-matched runtime images.');
