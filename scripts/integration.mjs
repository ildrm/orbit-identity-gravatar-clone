import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import * as OTPAuth from 'otpauth';
const base = process.env.TEST_API_ORIGIN ?? 'http://localhost:4000',
  delivery = process.env.TEST_DELIVERY_ORIGIN ?? 'http://localhost:4001',
  origin = process.env.PUBLIC_ORIGIN;
const name = 'test' + randomBytes(5).toString('hex');
let checks = 0;
function check(value, msg) {
  assert.ok(value, msg);
  checks++;
  process.stdout.write('PASS ' + msg + '\n');
}
class Client {
  cookie = '';
  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const cookie = res.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }
  async ok(path, options) {
    const r = await this.request(path, options);
    assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r));
    return r.data;
  }
}
async function until(fn) {
  for (let n = 0; n < 80; n++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for worker');
}
async function emailToken(email, template) {
  return until(async () => {
    const list = await fetch('http://localhost:8025/api/v1/messages').then((r) => r.json());
    const candidates = list.messages.filter((m) => m.To.some((t) => t.Address === email));
    for (const m of candidates) {
      const detail = await fetch('http://localhost:8025/api/v1/message/' + m.ID).then((r) =>
        r.json(),
      );
      if (detail.Text.includes(template)) {
        const token = detail.Text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
        if (token) return token;
      }
    }
  });
}
async function account(suffix) {
  const client = new Client(),
    email = name + suffix + '@example.test',
    password = 'A-long-test-password-2026!';
  const reg = await client.request('/api/v1/auth/register', {
    method: 'POST',
    body: { email, password },
  });
  check(reg.status === 201, 'registration accepted ' + suffix);
  const token = await emailToken(email, '/verify');
  await client.ok('/api/v1/auth/verify', { method: 'POST', body: { token } });
  check(
    (await client.request('/api/v1/auth/verify', { method: 'POST', body: { token } })).status ===
      400,
    'verification token is single use ' + suffix,
  );
  await client.ok('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  check(
    (await client.ok('/api/v1/auth/me')).email === email,
    'verified password sign-in ' + suffix,
  );
  return { client, email, password };
}
const owner = await account('owner'),
  other = await account('other'),
  anon = new Client();
const pub = {
  visibility: 'PUBLIC',
  searchable: true,
  indexable: true,
  api: true,
  machine: true,
  agent: false,
  applications: [],
  transformation: 'FULL',
};
const priv = {
  ...pub,
  visibility: 'PRIVATE',
  searchable: false,
  indexable: false,
  api: false,
  machine: false,
};
const identity = await owner.client.ok('/api/v1/identities', {
  method: 'POST',
  body: { type: 'PERSON', handle: name, displayName: 'Integration User', visibility: 'PUBLIC' },
});
check(/^idn_[a-f0-9]{32}$/.test(identity.id), 'identity uses an opaque permanent ID');
const p = '/api/v1/identities/' + identity.id;
const contextClaims = [];
for (const [key, value, visibility] of [
  ['core:pronouns', 'authenticated-context-value', 'AUTHENTICATED'],
  ['developer:languages', ['connection-context-value'], 'CONNECTIONS'],
  ['professional:job_title', 'organization-context-value', 'ORGANIZATION'],
]) {
  contextClaims.push(
    await owner.client.ok(p + '/claims', {
      method: 'PUT',
      body: { key, value, policy: { ...pub, visibility, searchable: false, indexable: false } },
    }),
  );
}
let viewerProfile = await anon.ok('/api/v1/profiles/' + identity.id);
check(
  !JSON.stringify(viewerProfile).includes('context-value'),
  'anonymous profile excludes context-restricted claims',
);
viewerProfile = await other.client.ok('/api/v1/profiles/' + identity.id);
check(
  JSON.stringify(viewerProfile).includes('authenticated-context-value') &&
    !JSON.stringify(viewerProfile).includes('connection-context-value') &&
    !JSON.stringify(viewerProfile).includes('organization-context-value'),
  'session grants only authenticated audience before proof',
);
const peer = await other.client.ok('/api/v1/identities', {
  method: 'POST',
  body: {
    type: 'PERSON',
    handle: name + '_peer',
    displayName: 'Context peer',
    visibility: 'PUBLIC',
  },
});
const connection = await owner.client.ok(p + '/relationships', {
  method: 'POST',
  body: { targetId: peer.id, type: 'contributes_to', policy: priv },
});
check(
  !JSON.stringify(await other.client.ok('/api/v1/profiles/' + identity.id)).includes(
    'connection-context-value',
  ),
  'unilateral relationship does not grant connection disclosure',
);
await other.client.ok('/api/v1/relationships/' + connection.id + '/confirm', { method: 'POST' });
check(
  JSON.stringify(await other.client.ok('/api/v1/profiles/' + identity.id)).includes(
    'connection-context-value',
  ),
  'mutual relationship grants connection disclosure to endpoint owner',
);
const personalizedHtml = await fetch(origin + '/u/' + name, {
  headers: { Cookie: other.client.cookie },
}).then((r) => r.text());
check(
  personalizedHtml.includes('connection-context-value') &&
    personalizedHtml.includes('authenticated-context-value'),
  'human profile uses current session audience',
);
const publicHtml = await fetch(origin + '/u/' + name).then((r) => r.text());
check(
  !publicHtml.includes('context-value'),
  'anonymous HTML and metadata exclude context-restricted values',
);
check(
  (await anon.request('/api/v1/relationships/' + connection.id, { method: 'DELETE' })).status ===
    401,
  'anonymous relationship revocation denied',
);
await other.client.ok('/api/v1/relationships/' + connection.id, { method: 'DELETE' });
check(
  !JSON.stringify(await other.client.ok('/api/v1/profiles/' + identity.id)).includes(
    'connection-context-value',
  ),
  'relationship revocation immediately removes connection audience',
);
const organization = await other.client.ok('/api/v1/identities', {
  method: 'POST',
  body: {
    type: 'ORGANIZATION',
    handle: name + '_org',
    displayName: 'Context organization',
    visibility: 'PUBLIC',
  },
});
const employment = await owner.client.ok(p + '/relationships', {
  method: 'POST',
  body: { targetId: organization.id, type: 'works_at', policy: priv },
});
check(
  !JSON.stringify(await other.client.ok('/api/v1/profiles/' + identity.id)).includes(
    'organization-context-value',
  ),
  'unilateral employment does not grant organization disclosure',
);
await other.client.ok('/api/v1/relationships/' + employment.id + '/confirm', { method: 'POST' });
check(
  JSON.stringify(await other.client.ok('/api/v1/profiles/' + identity.id)).includes(
    'organization-context-value',
  ),
  'confirmed affiliation grants organization member audience',
);
await owner.client.ok('/api/v1/relationships/' + employment.id, { method: 'DELETE' });
check(
  !JSON.stringify(await other.client.ok('/api/v1/profiles/' + identity.id)).includes(
    'organization-context-value',
  ),
  'affiliation revocation immediately removes organization audience',
);
for (const claim of contextClaims)
  await owner.client.ok(p + '/claims/' + claim.id, { method: 'DELETE' });

check((await other.client.request(p)).status === 403, 'other account cannot read owner view');
check((await anon.request(p)).status === 401, 'anonymous cannot read owner view');
check(
  (
    await other.client.request(p + '/claims', {
      method: 'PUT',
      body: { key: 'core:bio', value: 'attacker', policy: pub },
    })
  ).status === 403,
  'cross-account mutation denied',
);
await owner.client.ok(p + '/claims', {
  method: 'PUT',
  body: { key: 'core:bio', value: 'secret-private-bio-' + name, policy: priv },
});
let profile = await anon.ok('/api/v1/profiles/' + identity.id);
check(
  !JSON.stringify(profile).includes('secret-private-bio'),
  'public JSON excludes private claim',
);
await owner.client.ok(p + '/claims', {
  method: 'PUT',
  body: {
    key: 'core:location',
    value: 'Exact Street 42',
    policy: { ...pub, transformation: 'GENERALIZED', disclosedValue: 'Azerbaijan' },
  },
});
profile = await anon.ok('/api/v1/profiles/' + identity.id);
check(
  JSON.stringify(profile).includes('Azerbaijan') &&
    !JSON.stringify(profile).includes('Exact Street'),
  'generalized disclosure excludes exact location',
);
await owner.client.ok(p + '/claims', {
  method: 'PUT',
  body: { key: 'professional:employer', value: 'Owner organization', policy: pub },
});
const persona = await owner.client.ok(p + '/personas', {
  method: 'POST',
  body: { name: 'Professional', slug: 'professional' },
});
await owner.client.ok(p + '/claims', {
  method: 'PUT',
  body: {
    key: 'professional:employer',
    value: 'Hidden persona employer',
    policy: priv,
    personaId: persona.id,
  },
});
profile = await anon.ok('/api/v1/profiles/' + identity.id + '?persona=professional');
check(
  !profile.claims.some((c) => c.key === 'professional:employer'),
  'private persona override does not fall back to public base',
);
check(
  !JSON.stringify(await anon.ok('/api/v1/search?q=secret-private-bio')).includes(identity.id),
  'search excludes private bio',
);
await owner.client.ok(p + '/claims', {
  method: 'PUT',
  body: {
    key: 'core:website',
    value: 'https://example.com',
    policy: { ...pub, api: false, machine: false },
  },
});
check(
  !(await anon.ok('/api/v1/profiles/' + identity.id)).claims.some((c) => c.key === 'core:website'),
  'API channel filters a public human-only claim',
);
check(
  (await anon.request('/api/v1/profiles/' + identity.id + '?channel=human')).status === 400,
  'public caller cannot select internal human channel',
);
const settings = {
  visibility: 'PUBLIC',
  searchable: true,
  indexable: true,
  machine: true,
  agent: false,
  theme: 'light',
  locale: 'en',
};
await owner.client.ok(p + '/settings', { method: 'PUT', body: settings });
const machine = await anon.ok('/api/v1/profiles/' + identity.id + '?channel=machine');
check(
  !JSON.stringify(machine).includes('secret-private-bio') &&
    !machine.claims.some((c) => c.key === 'core:website'),
  'machine policy excludes private and human-only fields',
);
const card = await anon.ok('/api/v1/profiles/' + identity.id + '/vcard');
check(
  !card.includes('secret-private-bio') && !card.includes('https://example.com'),
  'vCard excludes prohibited fields',
);
check(
  (await anon.request('/api/v1/profiles/' + identity.id + '?channel=agent')).status === 404,
  'agent representation denied when disabled',
);
const app = await owner.client.ok('/api/v1/applications', {
  method: 'POST',
  body: { name: 'Integration app', purpose: 'Contract test' },
});
const consent = await owner.client.ok(p + '/consents', {
  method: 'POST',
  body: {
    applicationId: app.id,
    scopes: ['identity.read', 'profile.basic'],
    fields: ['core:display_name', 'professional:employer'],
  },
});
profile = await anon.ok('/api/v1/application/profile', {
  headers: { Authorization: 'Bearer ' + consent.token },
});
check(
  profile.claims.length === 1 && profile.claims[0].key === 'core:display_name',
  'consent combines scope and field allowlist',
);
check(profile.avatarUrl === '', 'avatar is excluded without avatar.read scope');
await owner.client.ok(p + '/consents/' + consent.id, { method: 'DELETE' });
check(
  (
    await anon.request('/api/v1/application/profile', {
      headers: { Authorization: 'Bearer ' + consent.token },
    })
  ).status === 401,
  'consent revocation stops access immediately',
);
check(
  (
    await owner.client.request('/api/v1/applications/' + app.id + '/webhooks', {
      method: 'POST',
      body: { url: 'https://127.0.0.1/hook', events: ['identity.updated'] },
    })
  ).status === 400,
  'SSRF webhook destination denied',
);
const avatar = await fetch(delivery + '/avatar/' + identity.id + '?size=128');
check(
  avatar.status === 200 && avatar.headers.get('content-type').includes('svg'),
  'generated SVG avatar delivered',
);
const etag = avatar.headers.get('etag');
check(
  (
    await fetch(delivery + '/avatar/' + identity.id + '?size=128', {
      headers: { 'If-None-Match': etag },
    })
  ).status === 304,
  'avatar conditional request returns 304',
);
check(
  (await fetch(delivery + '/avatar/' + identity.id + '?size=999999')).status === 400,
  'unbounded image dimensions denied',
);
const invalidImage = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const rejected = await owner.client.ok(p + '/media/upload', {
  method: 'POST',
  body: { bytes: invalidImage.length, alt: 'Rejected SVG security fixture' },
});
check(
  (await fetch(rejected.url, { method: 'PUT', headers: rejected.headers, body: invalidImage })).ok,
  'untrusted image can only enter private quarantine',
);
await owner.client.ok(p + '/media/' + rejected.id + '/complete', { method: 'POST', body: {} });
await until(async () =>
  (await owner.client.ok(p + '/media')).some(
    (m) => m.id === rejected.id && m.status === 'REJECTED',
  ),
);
check(
  (
    await owner.client.request(p + '/media/' + rejected.id + '/activate', {
      method: 'PUT',
      body: {},
    })
  ).status === 400,
  'rejected SVG cannot be activated',
);
check(
  (await fetch(delivery + '/assets/' + rejected.id + '/128.webp')).status === 404,
  'rejected image cannot be delivered',
);
const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#5755d9' } })
  .png()
  .toBuffer();
const upload = await owner.client.ok(p + '/media/upload', {
  method: 'POST',
  body: { bytes: image.length, alt: 'Integration geometric image' },
});
check(
  (await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: image })).ok,
  'signed private object upload',
);
await owner.client.ok(p + '/media/' + upload.id + '/complete', { method: 'POST', body: {} });
await until(async () => {
  const list = await owner.client.ok(p + '/media');
  return list.find((m) => m.id === upload.id && m.status === 'READY');
});
await owner.client.ok(p + '/media/' + upload.id + '/activate', { method: 'PUT', body: {} });
check(
  (await fetch(delivery + '/assets/' + upload.id + '/128.webp')).status === 200,
  'validated WebP variant delivered',
);
await owner.client.ok(p + '/settings', {
  method: 'PUT',
  body: { ...settings, visibility: 'PRIVATE' },
});
check(
  (await anon.request('/api/v1/profiles/' + identity.id)).status === 404,
  'private identity denies public profile',
);
check(
  (await fetch(delivery + '/assets/' + upload.id + '/128.webp')).status === 404,
  'private identity revokes origin asset access',
);
await owner.client.ok(p + '/settings', {
  method: 'PUT',
  body: { ...settings, visibility: 'UNLISTED' },
});
check(
  !(await anon.ok('/api/v1/search?q=' + name)).items.some((i) => i.id === identity.id),
  'unlisted identity excluded from search',
);
const renamed = name + 'new';
await owner.client.ok(p + '/handle', { method: 'PUT', body: { handle: renamed } });
check(
  (await anon.ok('/api/v1/profiles/' + name)).handle === renamed,
  'historical handle resolves to current identity',
);
check(
  (
    await owner.client.request('/api/v1/identities', {
      method: 'POST',
      body: { type: 'PERSON', handle: name, displayName: 'Collision' },
    })
  ).status === 409,
  'historical handle cannot be reused',
);
const exp = await owner.client.ok(p + '/exports', { method: 'POST', body: {} });
await until(async () => {
  const list = await owner.client.ok(p + '/exports');
  return list.some((e) => e.id === exp.id && e.status === 'READY');
});
check(
  (await other.client.request('/api/v1/exports/' + exp.id + '/download')).status === 404,
  'export download denies other account',
);
const download = await owner.client.ok('/api/v1/exports/' + exp.id + '/download'),
  bundle = await fetch(download.url).then((r) => r.json());
check(
  bundle.manifest.schemaVersion === '2.0' &&
    JSON.stringify(bundle.claims).includes('secret-private-bio'),
  'owner export contains private claims with versioned manifest',
);
check(
  (await anon.request('/api/v1/admin/reports')).status === 401,
  'anonymous moderator access denied',
);
check(
  (await owner.client.request('/api/v1/admin/reports')).status === 403,
  'non-moderator admin access denied',
);
check(
  (
    await owner.client.request(p + '/settings', {
      method: 'PUT',
      body: settings,
      headers: { Origin: 'https://attacker.example' },
    })
  ).status === 403,
  'untrusted mutation origin denied',
);
const spec = await anon.ok('/api/v1/openapi.json');
check(
  !!spec.components.schemas.ClaimInput && !!spec.paths[p.replace(identity.id, '{id}') + '/claims'],
  'OpenAPI includes input schemas and real routes',
);
check(
  (await anon.ok('/api/v1/application', { headers: { Authorization: 'Bearer ' + app.apiKey } }))
    .id === app.id,
  'application credential authenticates its own metadata',
);
check(
  (await anon.request(p, { headers: { Authorization: 'Bearer ' + app.apiKey } })).status === 401,
  'application credential cannot act as an identity owner',
);
const rotated = await owner.client.ok('/api/v1/applications/' + app.id + '/rotate', {
  method: 'POST',
  body: {},
});
check(
  (
    await anon.request('/api/v1/application', {
      headers: { Authorization: 'Bearer ' + app.apiKey },
    })
  ).status === 404,
  'rotation revokes previous application credential',
);
check(
  (await anon.ok('/api/v1/application', { headers: { Authorization: 'Bearer ' + rotated.apiKey } }))
    .id === app.id,
  'rotated application credential works',
);
await owner.client.ok(p + '/settings', {
  method: 'PUT',
  body: { ...settings, contactEnabled: true },
});
const contactPayload = {
  subject: 'A real integration message',
  body: 'Please reply to this message sent through the privacy relay.',
  shareEmail: true,
};
const relay = await other.client.ok('/api/v1/contact/' + identity.id, {
  method: 'POST',
  body: contactPayload,
});
check(
  !JSON.stringify(relay).includes(owner.email),
  'contact relay does not reveal recipient email',
);
await until(async () => {
  const inbox = await owner.client.ok(p + '/contact');
  return inbox.find((m) => m.state === 'SENT');
});
check(
  (await other.client.request(p + '/contact')).status === 403,
  'contact inbox denies another account',
);
const sender = await other.client.ok('/api/v1/auth/me');
await owner.client.ok(p + '/contact/blocks', { method: 'POST', body: { accountId: sender.id } });
await other.client.ok('/api/v1/contact/' + identity.id, { method: 'POST', body: contactPayload });
check(
  (await owner.client.ok(p + '/contact')).length === 1,
  'blocked sender cannot create another inbox message',
);
check(
  (
    await owner.client.request('/api/v1/auth/totp/setup', {
      method: 'POST',
      body: { proof: 'invalid' },
    })
  ).status === 403,
  'authenticator changes require recent password confirmation',
);
const step = await owner.client.ok('/api/v1/auth/stepup', {
  method: 'POST',
  body: { password: owner.password },
});
const setup = await owner.client.ok('/api/v1/auth/totp/setup', {
  method: 'POST',
  body: { proof: step.proof },
});
check(
  (
    await owner.client.request('/api/v1/auth/totp/setup', {
      method: 'POST',
      body: { proof: step.proof },
    })
  ).status === 403,
  'step-up proof is single use',
);
const totp = OTPAuth.URI.parse(setup.uri),
  code = totp.generate();
const enabled = await owner.client.ok('/api/v1/auth/totp/confirm', {
  method: 'POST',
  body: { token: setup.token, code },
});
check(
  enabled.backupCodes.length === 10,
  'authenticator enrollment returns single-use backup codes',
);
check(
  (
    await anon.request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: owner.email, password: owner.password },
    })
  ).status === 401,
  'password alone cannot bypass enrolled MFA',
);
check(
  (
    await anon.request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: owner.email, password: owner.password, code },
    })
  ).status === 401,
  'enrollment TOTP code cannot be replayed',
);
const recoveryCode = enabled.backupCodes[0];
await anon.ok('/api/v1/auth/login', {
  method: 'POST',
  body: { email: owner.email, password: owner.password, code: recoveryCode },
});
check(
  (
    await new Client().request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: owner.email, password: owner.password, code: recoveryCode },
    })
  ).status === 401,
  'backup code cannot be replayed',
);
await owner.client.ok('/api/v1/auth/recover', { method: 'POST', body: { email: owner.email } });
const resetToken = await emailToken(owner.email, '/reset');
const nextPassword = 'A-new-recovery-password-2026!';
await owner.client.ok('/api/v1/auth/reset', {
  method: 'POST',
  body: { token: resetToken, password: nextPassword, code: enabled.backupCodes[1] },
});
check(
  (await owner.client.request('/api/v1/auth/me')).status === 401,
  'password recovery revokes every existing account session',
);
check(
  (
    await new Client().request('/api/v1/auth/reset', {
      method: 'POST',
      body: { token: resetToken, password: nextPassword, code: enabled.backupCodes[2] },
    })
  ).status === 400,
  'recovery token is single use',
);
await owner.client.ok('/api/v1/auth/login', {
  method: 'POST',
  body: { email: owner.email, password: nextPassword, code: enabled.backupCodes[2] },
});
await owner.client.ok(p, { method: 'DELETE', body: { confirmation: renamed } });
for (const fixture of [peer, organization])
  await other.client.ok('/api/v1/identities/' + fixture.id, {
    method: 'DELETE',
    body: { confirmation: fixture.handle },
  });
check(
  (await anon.request('/api/v1/profiles/' + name)).status === 404,
  'deleted identity and historical handle stop resolving',
);
check(
  (await fetch(delivery + '/assets/' + upload.id + '/128.webp')).status === 404,
  'deletion revokes uploaded avatar access',
);
check(
  (await owner.client.request('/api/v1/exports/' + exp.id + '/download')).status === 404,
  'deletion revokes export authorization',
);
await owner.client.ok('/api/v1/auth/logout', { method: 'POST', body: {} });
check(
  (await owner.client.request('/api/v1/auth/me')).status === 401,
  'logout revokes the active session',
);
process.stdout.write('Integration checks passed: ' + checks + '\n');
