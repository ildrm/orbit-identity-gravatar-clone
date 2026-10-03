import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const original = readFileSync('docs/product/original-prompt.md', 'utf8');
const sections = Array.from(original.matchAll(/^# (\d+)\. ([^\r\n]+)/gm), (m) => ({
  id: Number(m[1]),
  title: m[2],
}));
assert.equal(sections.length, 132);
assert.equal(new Set(sections.map((s) => s.id)).size, 132);
const bundles = {
  process: [
    'docs/product/implementation-prompt.md',
    'docs/product/roles.md',
    'Role gates and release boundaries',
    'Recorded privacy/security review',
    'specification-check + release evidence',
    'docs/release-report.md',
    'Evidence artifacts and release manifest',
  ],
  foundation: [
    'Compose + domain migrations',
    'Next.js web/admin',
    'Explicit account/member/service boundaries',
    'Private defaults and storage',
    'Build/typecheck/migration/restore',
    'docs/architecture/design.md',
    'Readiness + private process metrics',
  ],
  identity: [
    'Identity/claims/personas/graph modules',
    'Profile/personas/history',
    'Current membership action matrix',
    'Persona authority before projection',
    'Integration/authorization/operations suites',
    'docs/user-guide.md',
    'Audit + revisions + request IDs',
  ],
  media: [
    'Media/avatar/delivery + consented-avatar',
    'Avatar & media/schedules',
    'Current publication or explicit avatar.read grant',
    'Quarantine/immutable IDs/no-store/fenced cache',
    'Unit/media/cache/private-avatar/fault checks',
    'docs/api.md',
    'Delivery/cache/job metrics',
  ],
  public: [
    'Profile/resolver/search/blocks/analytics',
    'SSR pages/editor/previews',
    'Current audience/channel/grant projections',
    'SQL selection + typed policy + no-store',
    'Integration/trust/operations/browser suites',
    'docs/security/privacy.md',
    'Aggregate counts and bounded request metrics',
  ],
  auth: [
    'Auth/account/OAuth modules',
    'Security/account/consent',
    'Verified active session and step-up',
    'Digests/key-ring encryption/replay checks',
    'MFA/WebAuthn/OAuth/account regressions',
    'docs/protocols.md',
    'Sanitized audit and quotas',
  ],
  apps: [
    'Applications/developer/OAuth',
    'Applications/Developer/consent receipts',
    'Current holder owner/app/token/scopes/fields',
    'No implicit disclosure; immediate revoke',
    'Advanced + operations + actual HTTPS webhook',
    'docs/api.md',
    'Metadata-only logs/usage/delivery states',
  ],
  verification: [
    'Domain/web-proof/DID/VC modules',
    'Verification/custom-domain/credential panels',
    'Specific proof/issuer/holder authority',
    'Private evidence and explicit publication',
    'Trust/TLS/operations; external inputs documented',
    'docs/protocols.md',
    'Expiry/revalidation/key/status metadata',
  ],
  providers: [
    'GitHub adapter/import + provider request circuit',
    'Connections/import review',
    'Single-use provider state/current owner',
    'Encrypted token/cache; private imported sources',
    'Parser/operations/provider network faults',
    'docs/api.md',
    'Sync errors/history/quotas/circuit',
  ],
  organizations: [
    'Organization/assertion/membership modules',
    'People & roles/Assertions',
    'Delegated action + distinct issuer/recipient',
    'Recipient acceptance starts private',
    'All eight roles/enterprise/credential checks',
    'docs/user-guide.md',
    'Actor audit/assertion status',
  ],
  portability: [
    'Merge/export/import/legacy/lifecycle',
    'Export/history/merge/account/legacy panels',
    'Proof of both owners/current authority',
    'Private import/restore; terminal deletion',
    'Advanced/trust/operations/encrypted full restore',
    'docs/operations/recovery.md',
    'Job/checksum/merge/revision records',
  ],
  security: [
    'Core policy/transport/moderation/key ring',
    'Safe errors/moderation/appeals',
    'Fail closed/current locks/independent appeals',
    'Redaction/SSRF/bounds/retention',
    'Unit/roles/privacy/security scans/fault suites',
    'docs/security/threat-model.md',
    'Sanitized logs and correlation IDs',
  ],
  operations: [
    'Worker/scheduler/cache/backup/metrics/release scripts',
    'Developer diagnostics/Prometheus UI',
    'Private operator/moderator boundaries',
    'Encrypted backups and guarded maintenance',
    'Migrations/restore/TLS/resilience/fault/performance',
    'docs/operations/deployment.md',
    'Prometheus SLIs/alerts/queue and pool metrics',
  ],
  dx: [
    'Versioned REST/TS/Python/PHP clients/CLI/plugin',
    'Developer portal/React/Gutenberg',
    'Scoped tokens and WordPress account binding',
    'Bounded transport/no secret URLs/local fallback',
    'SDK packs/contracts/Python/PHP/real WordPress',
    'integrations/README.md',
    'Typed errors/current request IDs',
  ],
};
const rows = new Map(
  sections.map((s) => [
    s.id,
    {
      ...s,
      bundle: 'process',
      status: 'Implemented',
      notes:
        'Repository implementation and local acceptance evidence; see release report for deployment and verification boundaries.',
    },
  ]),
);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function set(ids, bundle, notes, status = 'Implemented') {
  for (const id of ids) Object.assign(rows.get(id), { bundle, notes, status });
}
set(
  range(1, 5),
  'foundation',
  'Separate control/delivery/job processes, Docker dependencies, strict configuration and documented role review.',
);
set(
  range(6, 15),
  'identity',
  'Nine types, stable IDs, reserved handles, personas, typed localized claims, provenance/freshness/source selection and confirmed relationships.',
);
set(
  [16, 17, 19, 20, 21, 23],
  'media',
  'Five media purposes; immutable editing/variants; scheduled/persona/app/domain selections; fenced origin cache; documented generated/Gravatar subset. Public CDN capacity is deployment-specific.',
);
set(
  [22],
  'public',
  'Approved native/handle/domain/own-email/GitHub/DID adapters, current projections and provenance; external transports are bounded. Other potential providers in the source are extension points.',
);
set(
  [24, 25, 64],
  'providers',
  'GitHub OAuth/selected private import/sync/disconnect/history, encrypted credentials/cache, bounded retry/circuit/rate limit. Live provider authorization requires operator credentials.',
);
set(
  [26, 27, 28, 29, 30, 55],
  'verification',
  'DNS/well-known/rel=me/meta/cryptographic/issuer proof; gated custom-domain TLS; private JOSE VC and DID association/key lifecycle. Public DNS/ACME and cross-vendor conformance are not claimed from local fixtures.',
);
set(
  [31, 32, 33, 52],
  'public',
  'Separate visibility/discovery/channel/audience/transformation gates apply before disclosure; persona overrides suppress base fallback.',
);
set(
  [34, 35, 36, 40, 51, 67],
  'apps',
  'S256 PKCE public/confidential OAuth and native grants; receipts/activity; selected email/VC access; bounded app registration; real HTTPS HMAC retries/replay/rotation/current-consent checks.',
);
set(
  [37],
  'public',
  'Opt-in verified-sender private relay, explicit reply-address sharing, inbox/blocking and daily quotas.',
);
set(
  [38, 104],
  'auth',
  'Verified password/passkey/TOTP/recovery, single-use step-up and backup codes, session revocation, password/email changes and account settings/deletion.',
);
set(
  [41, 42, 43, 44],
  'organizations',
  'Eight delegated roles, email-bound invitations, immutable issuer assertion and private recipient acceptance/publication/dispute/revocation.',
);
set(
  [45, 46, 47, 48, 49, 50, 53, 54, 56, 57, 58, 59],
  'public',
  'Structured reorderable localized profile blocks, themes, sharing/vCard/QR, opt-in aggregates, machine/WebFinger/SEO/search and responsive keyboard/RTL controls.',
);
set(
  range(60, 63),
  'portability',
  'Explicit lifecycle, proved identity/account merge, source aliases/history/private provenance and versioned JSON/tar.gz archives with checked media and private import.',
);
set(
  [65, 84, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 112, 113, 114, 115, 116],
  'operations',
  'Self-hosted runtime, migrations/constraints/concurrent writes, authenticated database+S3 restore, leases/retention/revalidation, SLIs/alerts, separate workload/fault checks and immutable local release preparation. Host-specific publication/alert routing are operator inputs.',
);
set(
  [66],
  'verification',
  'Orbit federation v1: discovery, pinned approved peers, EdDSA JOSE audiences/expiry/replay/sequence, public cache/update/delete/blocking and independently signed source/destination migration.',
);
set(
  [68, 70, 71, 72, 73, 74, 75],
  'dx',
  'Live shared OpenAPI input/claim/query/auth/output contracts, packaged TS/React/Python/PHP clients, resolver CLI, real WordPress native/comment/author/BuddyPress/Gutenberg/REST integration and declarative extension schemas.',
);
set(
  [76, 77, 78, 79, 80, 81, 82, 83, 108, 109, 110],
  'security',
  'Headers/Origin/quotas, parameterized SQL, safe raster/SSRF/XSS controls, current permission and privacy denials, encrypted key ring, appeals/link safety/retention, secret/dependency/container scans.',
);
set(
  [85, 86],
  'portability',
  'Actual revision comparison/private restore including deleted blocks; digital legacy acceptance/encrypted evidence/wait/two reviewers/veto/terminal outcomes.',
);
set(
  range(97, 103),
  'foundation',
  'Typed modular applications, clear domain boundaries, deliberate saving, accessible responsive dashboard, structured editor/reordering and saved audience previews.',
);
set(
  [105],
  'dx',
  'Safe typed API errors/correlation IDs and OAuth protocol errors; bounded validation with no raw SQL/credential messages.',
);
set(
  [106],
  'process',
  'Current product/API/protocol/client/security/architecture/deployment/upgrade/recovery and evidence documentation.',
);
set(
  [107, 111],
  'security',
  'Behavioral unit, real HTTP/database/transport, Chrome keyboard/accessibility-tree/WCAG/reduced-motion/mobile/RTL checks. Automated accessibility evidence does not certify every assistive technology.',
);
set(
  [117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132],
  'process',
  'Full original scope/81 role perspectives retained; observable regressions, defect correction, current documentation and release artifact checks. Live GitHub/public DNS/SMTP and external publication require deployment inputs.',
);
set(
  [18, 39, 69],
  'process',
  'AI imagery, OIDC and GraphQL are explicitly conditional/optional in the source and remain disabled. No enabled protocol or synthetic verification is advertised.',
  'Optional disabled',
);
const columns = [
  'Requirement',
  'Feature',
  'Implementation status',
  'API',
  'UI',
  'Authorization',
  'Privacy',
  'Tests',
  'Documentation',
  'Observability',
  'Evidence boundaries / deployment inputs',
];
const lines = sections.map((s) => {
  const row = rows.get(s.id);
  return [
    s.id,
    s.title,
    row.status,
    ...(row.status === 'Optional disabled' ? Array(7).fill('Disabled') : bundles[row.bundle]),
    row.notes,
  ];
});
assert.ok(
  lines.every((row) => row.length === columns.length),
  'Ledger column mismatch',
);
const quote = (v) => '"' + String(v).replaceAll('"', '""') + '"';
writeFileSync(
  'docs/product/feature-matrix.csv',
  [columns, ...lines].map((row) => row.map(quote).join(',')).join('\n') + '\n',
);
writeFileSync(
  'docs/product/feature-matrix.md',
  '# Original requirement matrix\n\nAll 132 sections and all 81 roles are retained. Implemented records repository behavior and its local acceptance evidence within the documented protocol/provider subset; it does not assert external deployment, independent certification or global capacity. Optional disabled follows the source wording for AI, OIDC and GraphQL. Exact executed results and limitations are in [the release report](../release-report.md). This section-level index must be read with the original subsection requirements and linked module documentation.\n\nGenerated by scripts/requirements-ledger.mjs.\n\n| ' +
    columns.join(' | ') +
    ' |\n| ' +
    columns.map(() => '---').join(' | ') +
    ' |\n' +
    lines
      .map((row) => '| ' + row.map((v) => String(v).replaceAll('|', '/')).join(' | ') + ' |')
      .join('\n') +
    '\n',
);
console.log(
  'Recorded ' + lines.length + ' original sections and documented deployment boundaries.',
);
