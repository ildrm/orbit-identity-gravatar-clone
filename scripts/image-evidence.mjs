import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const images = [
  ['api', 'identity-platform-api'],
  ['web', 'identity-platform-web'],
  ['admin', 'identity-platform-admin'],
  ['postgres', 'identity-platform-postgres'],
  ['redis', 'redis:8.10.2-alpine'],
  ['storage', 'chrislusf/seaweedfs:4.48'],
  ['proxy', 'identity-platform-proxy'],
  ['tls', 'identity-platform-tls'],
];
const evidence = [];
for (const [service, image] of images) {
  const result = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'Image inspection: ' + image);
  const info = JSON.parse(result.stdout)[0];
  const scan = JSON.parse(readFileSync('reports/trivy-' + service + '.json', 'utf8'));
  const findings = (scan.Results ?? []).flatMap((row) => row.Vulnerabilities ?? []);
  assert.equal(
    findings.filter((v) => ['HIGH', 'CRITICAL'].includes(v.Severity)).length,
    0,
    'Image vulnerability gate: ' + service,
  );
  assert.equal(scan.Metadata.ImageID, info.Id, 'Scan matches the current built image: ' + service);
  evidence.push({
    service,
    image,
    imageId: info.Id,
    createdAt: info.Created,
    scannedAt: scan.CreatedAt,
    highCriticalFindings: 0,
  });
}
writeFileSync(
  'docs/operations/image-manifest.json',
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      scope: 'Local built images; not a signed or approved production release',
      images: evidence,
    },
    null,
    2,
  ) + '\n',
);
console.log('Eight current image IDs match passing high/critical scan results.');
