for (const name of ['checkout', 'setup-node', 'upload-artifact']) {
  const latest = await fetch('https://api.github.com/repos/actions/' + name + '/releases/latest', {
    headers: { 'User-Agent': 'orbit-identity-build' },
  }).then(async (r) => {
    if (!r.ok) throw new Error('Release fetch failed ' + r.status);
    return r.json();
  });
  let reference = await fetch(
    'https://api.github.com/repos/actions/' + name + '/git/ref/tags/' + latest.tag_name,
    { headers: { 'User-Agent': 'orbit-identity-build' } },
  ).then((r) => r.json());
  if (reference.object.type === 'tag')
    reference = await fetch(reference.object.url, {
      headers: { 'User-Agent': 'orbit-identity-build' },
    }).then((r) => r.json());
  process.stdout.write(
    JSON.stringify({ name, version: latest.tag_name, sha: reference.object.sha }) + '\n',
  );
}
for (const repo of ['aquasecurity/trivy', 'gitleaks/gitleaks']) {
  const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
    headers: { 'User-Agent': 'orbit-identity-build' },
  });
  if (!response.ok) throw new Error('Scanner fetch failed');
  const release = await response.json();
  process.stdout.write(JSON.stringify({ repo, version: release.tag_name }) + '\n');
}
