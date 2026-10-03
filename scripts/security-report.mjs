import { readFileSync, existsSync } from 'node:fs';
for (const name of ['api', 'web', 'admin', 'postgres', 'redis', 'storage', 'proxy', 'tls']) {
  const path = 'reports/trivy-' + name + '.json';
  if (!existsSync(path)) continue;
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const vulnerabilities = (report.Results ?? []).flatMap((item) =>
    (item.Vulnerabilities ?? []).map((v) => ({
      id: v.VulnerabilityID,
      severity: v.Severity,
      package: v.PkgName,
      installed: v.InstalledVersion,
      fixed: v.FixedVersion ?? null,
      target: item.Target,
    })),
  );
  console.log(JSON.stringify({ image: name, os: report.Metadata?.OS, findings: vulnerabilities }));
}
