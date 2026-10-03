import { randomBytes, createHash } from 'node:crypto';
import { Client as PgClient } from 'pg';
import { SignJWT, CompactSign, generateKeyPair, exportJWK, importJWK, compactVerify } from 'jose';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { Client, account, name, origin, check, checks } from './test-client.mjs';
import { decrypt } from '../dist/packages/core/src/security.js';
const owner = await account('trustowner'),
  holder = await account('trustholder'),
  anon = new Client(),
  pg = new PgClient({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const ids = [],
  peerIds = [],
  pub = {
    visibility: 'PUBLIC',
    searchable: true,
    indexable: true,
    api: true,
    machine: true,
    agent: false,
    applications: [],
    transformation: 'FULL',
  },
  priv = {
    ...pub,
    visibility: 'PRIVATE',
    searchable: false,
    indexable: false,
    api: false,
    machine: false,
  };
const makeId = (prefix) => prefix + '_' + randomBytes(16).toString('hex');
async function identity(client, suffix, type = 'PERSON') {
  const i = await client.ok('/api/v1/identities', {
    method: 'POST',
    body: {
      type,
      handle: name + suffix,
      displayName: 'Trust fixture ' + suffix,
      visibility: 'PUBLIC',
    },
  });
  ids.push({ id: i.id, handle: i.handle, client });
  return i;
}
try {
  const person = await identity(holder.client, 'person'),
    issuer = await identity(owner.client, 'issuer', 'ORGANIZATION'),
    legacy = await identity(owner.client, 'legacy'),
    path = '/api/v1/identities/' + person.id;
  const block = await holder.client.ok(path + '/blocks', {
    method: 'POST',
    body: {
      kind: 'biography',
      title: 'private-title-canary',
      position: 0,
      enabled: true,
      configuration: { text: 'private-block-canary', items: [] },
      policy: priv,
    },
  });
  check(
    !JSON.stringify(await anon.ok('/api/v1/profiles/' + person.id)).includes(
      'private-block-canary',
    ),
    'Private block content is absent from anonymous JSON',
  );
  check(
    !(await anon.request('/u/' + person.handle)).data.includes('private-title-canary'),
    'Private block title is absent from SSR HTML',
  );
  await holder.client.ok(path + '/blocks/' + block.id, {
    method: 'PUT',
    body: {
      kind: 'biography',
      title: 'public fixture block',
      position: 0,
      enabled: true,
      configuration: { text: 'public-block-value', items: [] },
      policy: pub,
    },
  });
  check(
    (await anon.ok('/api/v1/profiles/' + person.id)).blocks.some(
      (b) => b.configuration.text === 'public-block-value',
    ),
    'Enabled public blocks project through the policy engine',
  );
  await holder.client.ok(path + '/analytics/settings', { method: 'PUT', body: { enabled: true } });
  await anon.ok('/api/v1/profiles/' + person.id + '/activity', {
    method: 'POST',
    body: { kind: 'profile_view' },
    headers: { DNT: '1' },
  });
  check(
    (await holder.client.ok(path + '/analytics')).days.length === 0,
    'DNT prevents aggregate collection',
  );
  await anon.ok('/api/v1/profiles/' + person.id + '/activity', {
    method: 'POST',
    body: { kind: 'profile_view' },
  });
  check(
    (await holder.client.ok(path + '/analytics')).days.some(
      (d) => d.kind === 'profile_view' && Number(d.count) === 1,
    ),
    'Opt-in analytics store only aggregate counts',
  );
  await holder.client.ok(path + '/analytics/settings', { method: 'PUT', body: { enabled: false } });
  check(
    (await holder.client.ok(path + '/analytics')).days.length === 0,
    'Disabling analytics removes prior counters',
  );
  const didDocument = await owner.client.ok('/api/v1/identities/' + issuer.id + '/did/enable', {
    method: 'POST',
    body: { proof: await owner.proof() },
  });
  check(
    didDocument.id.startsWith('did:web:') && !JSON.stringify(didDocument).includes('private'),
    'DID documents publish public key material only',
  );
  const assertion = await owner.client.ok('/api/v1/organizations/' + issuer.id + '/assertions', {
    method: 'POST',
    body: {
      subjectId: person.id,
      key: 'org:certification',
      value: 'private-credential-canary',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  await holder.client.ok(path + '/assertions/' + assertion.id + '/accept', {
    method: 'POST',
    body: { policy: priv },
  });
  const credential = await owner.client.ok('/api/v1/organizations/' + issuer.id + '/credentials', {
    method: 'POST',
    body: { assertionId: assertion.id },
  });
  check(
    (await anon.request('/api/v1/credentials/' + credential.id)).status === 401,
    'Credential contents require an authenticated holder',
  );
  check(
    (await owner.client.request('/api/v1/credentials/' + credential.id)).status === 403,
    'Issuer cannot download a recipient private credential',
  );
  const token = await holder.client.ok('/api/v1/credentials/' + credential.id),
    jws = await compactVerify(
      token,
      await importJWK(didDocument.verificationMethod[0].publicKeyJwk, 'EdDSA'),
    );
  check(
    jws.protectedHeader.typ === 'vc+jwt' &&
      JSON.parse(Buffer.from(jws.payload).toString()).type.includes('VerifiableCredential'),
    'Downloaded VC verifies cryptographically against the public issuer DID',
  );
  check(
    (
      await holder.client.ok('/api/v1/credentials/verify', {
        method: 'POST',
        body: { credential: token },
      })
    ).valid,
    'Verifier checks the live issuer, assertion, key, expiry and signature',
  );
  check(
    !JSON.stringify(await anon.ok('/api/v1/profiles/' + person.id)).includes(
      'private-credential-canary',
    ),
    'Credential and accepted private assertion remain absent from public profiles',
  );
  const rotated = await owner.client.ok('/api/v1/identities/' + issuer.id + '/did/rotate', {
    method: 'POST',
    body: { proof: await owner.proof() },
  });
  check(
    rotated.authentication.length === 1 && rotated.assertionMethod.length === 2,
    'Key rotation retains old credential verification keys and changes authentication key',
  );
  check(
    (
      await holder.client.ok('/api/v1/credentials/verify', {
        method: 'POST',
        body: { credential: token },
      })
    ).valid,
    'Credentials remain verifiable after graceful issuer key rotation',
  );
  const challenge = await holder.client.ok(path + '/did/challenge', {
    method: 'POST',
    body: { did: rotated.id },
  });
  const currentKey = (
      await pg.query(
        "SELECT private_encrypted FROM signing_keys WHERE identity_id=$1 AND state='ACTIVE'",
        [issuer.id],
      )
    ).rows[0],
    privateKey = await importJWK(JSON.parse(decrypt(currentKey.private_encrypted)), 'EdDSA');
  const proof = await new CompactSign(Buffer.from(JSON.stringify(challenge.payload)))
    .setProtectedHeader({ alg: 'EdDSA', kid: rotated.authentication[0] })
    .sign(privateKey);
  await holder.client.ok(path + '/did/associate', {
    method: 'POST',
    body: { did: rotated.id, proof },
  });
  check(
    (await holder.client.ok(path + '/did/associations')).some(
      (a) => a.did === rotated.id && !a.revoked_at,
    ),
    'Nonce-bound signed DID association succeeds',
  );
  check(
    (
      await holder.client.request(path + '/did/associate', {
        method: 'POST',
        body: { did: rotated.id, proof },
      })
    ).status >= 400,
    'DID association challenge replay is rejected',
  );
  const oldKey = didDocument.verificationMethod[0].id.split('#')[1];
  await owner.client.ok('/api/v1/identities/' + issuer.id + '/did/keys/' + oldKey, {
    method: 'DELETE',
    body: { proof: await owner.proof() },
  });
  check(
    (await anon.ok('/api/v1/credentials/' + credential.id + '/status')).status === 'INVALID',
    'Revoking a signing key immediately invalidates its credentials',
  );
  check(
    (
      await holder.client.request('/api/v1/credentials/verify', {
        method: 'POST',
        body: { credential: token },
      })
    ).status >= 400,
    'Verifier rejects a credential after key revocation',
  );
  const exportedValue = 'export-private-canary';
  await holder.client.ok(path + '/claims', {
    method: 'PUT',
    body: { key: 'core:bio', value: exportedValue, policy: priv },
  });
  const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#583ede' },
    })
      .png()
      .toBuffer(),
    media = await holder.client.ok(path + '/media/upload', {
      method: 'POST',
      body: { bytes: image.length, alt: 'Archive fixture' },
    });
  const upload = await fetch(media.url, { method: 'PUT', headers: media.headers, body: image });
  check(upload.ok, 'Signed private upload accepts the exact image bytes');
  await holder.client.ok(path + '/media/' + media.id + '/complete', { method: 'POST' });
  for (let n = 0; n < 80; n++) {
    if (
      (await holder.client.ok(path + '/media')).find((m) => m.id === media.id)?.status === 'READY'
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const exp = await holder.client.ok(path + '/exports', { method: 'POST' });
  let ready = false;
  for (let n = 0; n < 80; n++) {
    ready =
      (await holder.client.ok(path + '/exports')).find((e) => e.id === exp.id)?.status === 'READY';
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(ready, 'Worker generates a complete JSON export and compressed media archive');
  const exportUrl = (await holder.client.ok('/api/v1/exports/' + exp.id + '/download')).url,
    bundle = await fetch(exportUrl).then((r) => r.json());
  check(
    bundle.manifest.schemaVersion === '2.0' && bundle.claims.some((c) => c.value === exportedValue),
    'Versioned owner export includes private claims',
  );
  const archiveUrl = (
      await holder.client.ok('/api/v1/exports/' + exp.id + '/download?format=archive')
    ).url,
    archive = gunzipSync(Buffer.from(await fetch(archiveUrl).then((r) => r.arrayBuffer()))),
    entries = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const path = header.subarray(0, 100).toString().split('\0')[0],
      size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
    entries.set(path, archive.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  check(
    entries.has('media/' + media.id + '/source.png') &&
      entries.has('avatars/' + media.id + '/128.webp'),
    'Media archive contains validated source images and generated variants',
  );
  for (const sum of JSON.parse(entries.get('checksums.json').toString()))
    check(
      createHash('sha256').update(entries.get(sum.path)).digest('hex') === sum.sha256,
      'Archive checksum validates ' + sum.path,
    );
  const preview = await holder.client.ok(path + '/imports/preview', {
    method: 'POST',
    body: { bundle },
  });
  check(
    preview.claims.length > 0 && preview.claims.every((c) => !('policy' in c)),
    'Import validation strips inherited publication and verification authority',
  );
  await holder.client.ok(path + '/imports', {
    method: 'POST',
    body: { source: 'owner-export', claims: preview.claims },
  });
  check(
    (await holder.client.ok(path + '/claims')).some(
      (c) => c.source === 'EXTERNAL_IMPORT' && !c.selected && c.policy.visibility === 'PRIVATE',
    ),
    'Import preserves existing authoritative claims and creates private conflicts',
  );
  const revisions = await holder.client.ok(path + '/revisions'),
    comparison = await holder.client.ok(path + '/revisions/' + revisions[0].id);
  check(
    Array.isArray(comparison.changes),
    'Revision comparison returns actual before and after values',
  );
  await holder.client.ok(path + '/revisions/' + revisions[0].id + '/restore', {
    method: 'POST',
    body: { proof: await holder.proof() },
  });
  check(
    !(await anon.ok('/api/v1/profiles/' + person.id)).claims.some((c) => c.value === exportedValue),
    'Revision restore does not republish private historical values',
  );
  await owner.client.ok('/api/v1/identities/' + legacy.id + '/legacy', {
    method: 'PUT',
    body: { custodianEmail: holder.email, outcome: 'FREEZE', proof: await owner.proof() },
  });
  check(
    (await holder.client.request('/api/v1/identities/' + legacy.id + '/claims')).status === 403,
    'Legacy nomination grants no current profile management',
  );
  await holder.client.ok('/api/v1/legacy/' + legacy.id + '/accept', { method: 'POST' });
  const request = await holder.client.ok('/api/v1/legacy/' + legacy.id + '/request', {
    method: 'POST',
    body: {
      evidence: 'Synthetic evidence for the digital legacy request. '.repeat(4),
      proof: await holder.proof(),
    },
  });
  const requests = await owner.client.ok('/api/v1/identities/' + legacy.id + '/legacy');
  check(
    new Date(requests.requests[0].not_before).getTime() > Date.now() + 29 * 86400000,
    'Digital legacy enforces a 30-day waiting period',
  );
  await owner.client.ok('/api/v1/identities/' + legacy.id + '/legacy/veto', {
    method: 'POST',
    body: { proof: await owner.proof() },
  });
  check(
    (await owner.client.ok('/api/v1/identities/' + legacy.id + '/legacy')).requests.find(
      (r) => r.id === request.id,
    ).state === 'VETOED',
    'Owner veto blocks the pending legacy action',
  );
  check(
    (await pg.query('SELECT evidence_encrypted FROM legacy_requests WHERE id=$1', [request.id]))
      .rows[0].evidence_encrypted === '',
    'Veto immediately removes private legacy evidence',
  );
  const peerOrigin = 'https://' + name + '.peer.example',
    peerDid = 'did:web:' + new URL(peerOrigin).host,
    peerKey = await generateKeyPair('EdDSA', { crv: 'Ed25519' }),
    kid = peerDid + '#test-key',
    document = {
      id: peerDid,
      verificationMethod: [
        {
          id: kid,
          type: 'JsonWebKey2020',
          controller: peerDid,
          publicKeyJwk: await exportJWK(peerKey.publicKey),
        },
      ],
      authentication: [kid],
      assertionMethod: [kid],
    },
    peerId = makeId('peer');
  peerIds.push(peerId);
  await pg.query(
    'INSERT INTO federation_peers(id,origin,did,document,fingerprint,approved_by) VALUES($1,$2,$3,$4,$5,$6)',
    [
      peerId,
      peerOrigin,
      peerDid,
      JSON.stringify(document),
      createHash('sha256').update(JSON.stringify(document)).digest('hex'),
      owner.id,
    ],
  );
  const remoteId = makeId('idn'),
    actor = peerOrigin + '/api/v1/profiles/' + remoteId,
    object = {
      id: remoteId,
      handle: 'remote_fixture',
      type: 'PERSON',
      revision: 1,
      displayName: 'Remote fixture',
      claims: [],
      avatarUrl: peerOrigin + '/avatar/' + remoteId,
    };
  async function sign(sequence, type = 'Update', value = object, options = {}) {
    const jti = options.jti ?? makeId('fmsg'),
      now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      protocol: '1',
      sequence,
      activity: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: peerOrigin + '/api/v1/federation/messages/' + jti,
        type,
        actor,
        object: value,
      },
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'orbit-federation+jwt', kid })
      .setIssuer(peerDid)
      .setAudience(options.audience ?? origin)
      .setJti(jti)
      .setIssuedAt(options.iat ?? now)
      .setExpirationTime(options.exp ?? now + 120)
      .sign(options.key ?? peerKey.privateKey);
  }
  const signed = await sign(1);
  check(
    (
      await anon.ok('/api/v1/federation/inbox', {
        method: 'POST',
        body: { message: signed },
        headers: { Origin: 'https://unrelated.example' },
      })
    ).accepted,
    'Federation inbox verifies an approved peer signature independently of browser sessions',
  );
  check(
    (await anon.ok('/api/v1/federation/resolve?actor=' + encodeURIComponent(actor))).displayName ===
      'Remote fixture',
    'Signed remote update becomes resolvable from bounded cache',
  );
  check(
    (await anon.ok('/api/v1/federation/inbox', { method: 'POST', body: { message: signed } }))
      .duplicate,
    'Federation message replay is idempotent',
  );
  check(
    (
      await anon.request('/api/v1/federation/inbox', {
        method: 'POST',
        body: { message: await sign(2, 'Update', object, { audience: 'https://wrong.example' }) },
      })
    ).status === 403,
    'Federation rejects messages signed for another audience',
  );
  check(
    (
      await anon.request('/api/v1/federation/inbox', {
        method: 'POST',
        body: { message: await sign(2, 'Update', object, { iat: 1, exp: 120 }) },
      })
    ).status === 403,
    'Federation rejects expired signed messages',
  );
  check(
    (
      await anon.ok('/api/v1/federation/inbox', {
        method: 'POST',
        body: { message: await sign(3, 'Delete', null) },
      })
    ).accepted,
    'Signed deletion purges the cached profile',
  );
  check(
    (await anon.request('/api/v1/federation/resolve?actor=' + encodeURIComponent(actor))).status ===
      404,
    'Deleted remote profile is no longer resolvable',
  );
  check(
    (
      await anon.ok('/api/v1/federation/inbox', {
        method: 'POST',
        body: { message: await sign(2) },
      })
    ).stale,
    'Older updates cannot reverse a newer deletion',
  );
  await pg.query('UPDATE federation_peers SET blocked_at=now() WHERE id=$1', [peerId]);
  check(
    (
      await anon.request('/api/v1/federation/inbox', {
        method: 'POST',
        body: { message: await sign(4) },
      })
    ).status === 403,
    'Blocked peer cannot publish further signed updates',
  );
  check(
    (await owner.client.ok('/api/v1/notifications')).some((n) => n.kind === 'legacy.requested'),
    'Relevant lifecycle activity produces an account-bound notification',
  );
  check(
    (await anon.request('/api/v1/notifications')).status === 401,
    'Notifications require the account session',
  );
  await holder.client.ok('/api/v1/account/settings', {
    method: 'PATCH',
    body: { locale: 'fa', timezone: 'Asia/Tehran' },
  });
  check(
    (await holder.client.ok('/api/v1/auth/me')).locale === 'fa',
    'Account locale and IANA timezone settings persist',
  );
  check(
    (
      await holder.client.request('/api/v1/account/settings', {
        method: 'PATCH',
        body: { locale: 'fa', timezone: 'invalid/timezone' },
      })
    ).status === 400,
    'Invalid timezones are rejected',
  );
  for (const i of ids)
    await i.client.ok('/api/v1/identities/' + i.id, {
      method: 'DELETE',
      body: { confirmation: i.handle },
    });
  check(
    (await holder.client.request('/api/v1/exports/' + exp.id + '/download?format=archive'))
      .status >= 400,
    'Deletion revokes access to private exports and archives',
  );
  process.stdout.write(JSON.stringify({ status: 'passed', checks }) + '\n');
} finally {
  for (const peerId of peerIds) {
    await pg.query('DELETE FROM remote_profiles WHERE peer_id=$1', [peerId]);
    await pg.query('DELETE FROM federation_receipts WHERE peer_id=$1', [peerId]);
    await pg.query("DELETE FROM jobs WHERE kind='federation' AND payload->>'peerId'=$1", [peerId]);
    await pg.query('DELETE FROM federation_peers WHERE id=$1', [peerId]);
  }
  await pg.end();
}
