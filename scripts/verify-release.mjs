import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'parse5';
const manifest = JSON.parse(readFileSync('docs/operations/release-manifest.json', 'utf8'));
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
for (const path of files)
  hash
    .update(path + '\0')
    .update(readFileSync(path))
    .update('\0');
assert.equal(
  hash.digest('hex'),
  manifest.sourceHash,
  'Prepared release matches the current source snapshot',
);
for (const item of manifest.evidence)
  assert.equal(
    createHash('sha256').update(readFileSync(item.path)).digest('hex'),
    item.sha256,
    'Release evidence remains unchanged: ' + item.path,
  );
for (const image of manifest.images) {
  const actual = JSON.parse(
    execFileSync('docker', ['image', 'inspect', image.tag], { encoding: 'utf8' }),
  )[0];
  assert.equal(actual.Id, image.imageId, 'Immutable release image: ' + image.service);
}
const output = execFileSync('docker', ['compose', 'ps', '--all', '--format', 'json'], {
  encoding: 'utf8',
}).trim();
const containers = output.startsWith('[')
  ? JSON.parse(output)
  : output
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
const runtime = [];
for (const image of manifest.images.filter((i) => i.service !== 'tls-edge')) {
  const container = containers.find((c) => c.Service === image.service);
  assert.ok(container, 'Local runtime service exists: ' + image.service);
  const oneShot = ['migrate', 'storage-init'].includes(image.service);
  if (oneShot) {
    assert.equal(container.State, 'exited');
    assert.equal(container.ExitCode, 0);
  } else {
    assert.equal(container.State, 'running');
    assert.notEqual(container.Health, 'unhealthy');
    assert.notEqual(container.Health, 'starting');
  }
  const actual = execFileSync('docker', ['inspect', '--format', '{{.Image}}', container.ID], {
    encoding: 'utf8',
  }).trim();
  assert.equal(
    actual,
    image.imageId,
    'Running container uses the verified release image: ' + image.service,
  );
  runtime.push({
    service: image.service,
    state: container.State,
    health: container.Health || null,
    imageId: actual,
  });
}
const origin =
  process.env.ORBIT_RELEASE_VERIFY_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080';
for (const path of [
  '/health/ready',
  '/',
  '/api/v1/openapi.json',
  '/avatar/release-verification?size=64&format=svg',
]) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'Release public/readiness probe: ' + path);
  await response.arrayBuffer();
}
const anonymous = await fetch(new URL('/dashboard', origin), {
  redirect: 'manual',
  signal: AbortSignal.timeout(15000),
});
if ([302, 303, 307, 308].includes(anonymous.status)) {
  assert.equal(new URL(anonymous.headers.get('location'), origin).pathname, '/login');
} else {
  assert.equal(anonymous.status, 200, 'Next.js streaming redirect response');
  function hasLoginRedirect(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value]));
    if (node.tagName === 'meta' && attrs['http-equiv']?.toLowerCase() === 'refresh') {
      const target = /^\s*\d+\s*;\s*url=(.+)\s*$/i.exec(attrs.content ?? '')?.[1];
      if (target) {
        const url = new URL(target, origin);
        if (url.origin === new URL(origin).origin && url.pathname === '/login') return true;
      }
    }
    return (node.childNodes ?? []).some(hasLoginRedirect);
  }
  assert.ok(
    hasLoginRedirect(parse(await anonymous.text())),
    'Anonymous streamed page redirects to login',
  );
}
for (const path of ['/api/v1/auth/me', '/api/v1/identities']) {
  const denied = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
  assert.equal(denied.status, 401, 'Anonymous access to protected account data is denied');
  await denied.arrayBuffer();
}
writeFileSync(
  'reports/release-verification.json',
  JSON.stringify(
    {
      passed: true,
      checkedAt: new Date().toISOString(),
      sourceHash: manifest.sourceHash,
      immutableImages: manifest.images.length,
      evidenceReports: manifest.evidence.length,
      runtime,
      scope:
        'Local source, evidence, immutable image and running container verification with public/readiness/anonymous-denial probes. TLS edge is independently rehearsed, not publicly deployed.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Verified current source, ' +
    manifest.evidence.length +
    ' evidence reports, ' +
    manifest.images.length +
    ' immutable images and ' +
    runtime.length +
    ' local runtime roles.',
);
