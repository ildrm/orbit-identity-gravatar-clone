import assert from 'node:assert/strict';
import { Client as PgClient } from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, generateKeyPair, exportJWK, compactVerify, importJWK } from 'jose';
import sharp from 'sharp';
import Redis from 'ioredis';
import { Client, check, checks, origin } from './test-client.mjs';
const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
await pg.connect();
const { beginDeliveryWrite, endDeliveryWrite } =
  await import('../dist/packages/core/src/delivery-cache.js');
const fixtureQuery = pg.query.bind(pg);
pg.query = async (...args) => {
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
  if (!/\b(?:UPDATE|INSERT|DELETE)\b/i.test(sql ?? '')) return fixtureQuery(...args);
  await beginDeliveryWrite();
  try {
    return await fixtureQuery(...args);
  } finally {
    await endDeliveryWrite();
  }
};
const redis = new Redis(process.env.REDIS_URL),
  prefix = process.env.OPERATOR_TEST_PREFIX;
assert.match(prefix, /^ops[a-f0-9]{12}$/);
const makeId = (p) => p + '_' + randomBytes(16).toString('hex'),
  password = 'Operational-fixture-password!2026',
  hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  }),
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
  },
  priv = {
    ...pub,
    visibility: 'PRIVATE',
    searchable: false,
    indexable: false,
    api: false,
    machine: false,
  };
async function pace() {
  const keys = await redis.keys('rate:auth:*');
  for (const k of keys) {
    if (Number(await redis.get(k)) >= 18) {
      const ttl = await redis.ttl(k);
      if (ttl > 0) {
        console.log('Respecting authentication quota; waiting ' + ttl + ' seconds.');
        await new Promise((r) => setTimeout(r, (ttl + 1) * 1000));
      }
    }
  }
}
async function account(suffix) {
  const id = makeId('acc'),
    email = prefix + suffix + '@example.test',
    client = new Client();
  await pg.query(
    'INSERT INTO accounts(id,email,password_hash,verified_at) VALUES($1,$2,$3,now())',
    [id, email, hash],
  );
  await pace();
  await client.ok('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  return {
    id,
    email,
    client,
    password,
    async proof() {
      await pace();
      return (await client.ok('/api/v1/auth/stepup', { method: 'POST', body: { password } })).proof;
    },
  };
}
async function identity(a, suffix, type = 'PERSON') {
  return a.client.ok('/api/v1/identities', {
    method: 'POST',
    body: {
      type,
      handle: prefix + suffix,
      displayName: 'Operations ' + suffix,
      visibility: 'PUBLIC',
    },
  });
}
async function upload(a, i, purpose) {
  const data = await sharp({
      create: { width: 40, height: 30, channels: 4, background: '#8445cc80' },
    })
      .png()
      .toBuffer(),
    path = '/api/v1/identities/' + i.id + '/media',
    m = await a.client.ok(path + '/upload', {
      method: 'POST',
      body: { bytes: data.length, alt: 'Fixture ' + purpose, purpose },
    });
  assert.ok((await fetch(m.url, { method: 'PUT', headers: m.headers, body: data })).ok);
  await a.client.ok(path + '/' + m.id + '/complete', { method: 'POST' });
  for (let n = 0; n < 120; n++) {
    const current = (await a.client.ok(path)).find((r) => r.id === m.id);
    if (current?.status === 'READY') return m;
    if (current?.status === 'REJECTED') throw new Error('Image rejected');
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Media processing timeout');
}
async function asset(m) {
  return fetch(process.env.TEST_DELIVERY_ORIGIN + '/assets/' + m.id + '/128.webp', {
    redirect: 'manual',
  });
}
async function oauth(a, i, fields, scopes) {
  const app = await a.client.ok('/api/v1/oauth/clients', {
      method: 'POST',
      body: {
        name: 'Credential consent fixture',
        purpose: 'Read only selected private credentials',
        redirectUris: ['http://127.0.0.1:9456/callback'],
        mode: 'PUBLIC',
      },
    }),
    verifier = randomBytes(32).toString('base64url'),
    parameters = {
      client_id: app.client_id,
      redirect_uri: app.redirect_uris[0],
      response_type: 'code',
      scope: scopes.join(' '),
      fields: fields.join(' '),
      state: randomBytes(24).toString('base64url'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    };
  const response = await a.client.request(
    '/api/v1/oauth/authorize?' + new URLSearchParams(parameters),
    { redirect: 'manual' },
  );
  assert.equal(response.status, 302, JSON.stringify(response.data));
  const requestId = new URL(response.headers.get('location')).searchParams.get('request');
  const decision = await a.client.ok('/api/v1/oauth/requests/' + requestId + '/decision', {
      method: 'POST',
      body: { approve: true, identityId: i.id, fields, scopes },
    }),
    code = new URL(decision.redirect).searchParams.get('code');
  const exchange = await fetch(origin + '/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: app.client_id,
      redirect_uri: parameters.redirect_uri,
      code,
      code_verifier: verifier,
    }),
  });
  assert.equal(exchange.status, 200);
  return { app, ...(await exchange.json()) };
}
async function peer(origin, label) {
  const pair = await generateKeyPair('EdDSA'),
    id = makeId('peer'),
    did = 'did:web:' + new URL(origin).hostname,
    key = did + '#key',
    jwk = await exportJWK(pair.publicKey),
    document = { id };
  document.id = did;
  document.verificationMethod = [
    { id: key, type: 'JsonWebKey2020', controller: did, publicKeyJwk: jwk },
  ];
  document.authentication = [key];
  document.assertionMethod = [key];
  await pg.query(
    'INSERT INTO federation_peers(id,origin,did,document,fingerprint,approved_by) VALUES($1,$2,$3,$4,$5,$6)',
    [
      id,
      origin,
      did,
      JSON.stringify(document),
      createHash('sha256').update(JSON.stringify(document)).digest('hex'),
      label,
    ],
  );
  return { id, origin, did, key, ...pair };
}
function acceptance(p, source, target, nonce, audience = process.env.PUBLIC_ORIGIN) {
  return new SignJWT({ source, target, nonce })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'orbit-migration+jwt', kid: p.key })
    .setIssuer(p.did)
    .setAudience(audience)
    .setJti(makeId('mig'))
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(p.privateKey);
}
function activity(p, actor, type, object, sequence) {
  const jti = makeId('fmsg');
  return new SignJWT({
    protocol: '1',
    sequence,
    activity: {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: p.origin + '/api/v1/federation/messages/' + jti,
      type,
      actor,
      object,
    },
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'orbit-federation+jwt', kid: p.key })
    .setIssuer(p.did)
    .setAudience(process.env.PUBLIC_ORIGIN)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(p.privateKey);
}
try {
  const owner = await account('owner'),
    holder = await account('holder'),
    custodian = await account('custodian'),
    modone = await account('modone'),
    modtwo = await account('modtwo'),
    person = await identity(holder, 'person'),
    organization = await identity(owner, 'organization', 'ORGANIZATION'),
    source = await identity(holder, 'source'),
    path = '/api/v1/identities/' + person.id;
  check(
    (await anon.request('/api/v1/admin/federation/peers')).status === 401,
    'Anonymous peer administration denied',
  );
  check(
    (await holder.client.request('/api/v1/admin/appeals')).status === 403,
    'Ordinary owner cannot inspect moderator appeals',
  );
  check(
    (
      await holder.client.request(
        '/api/v1/resolve?type=email&identifier=' + encodeURIComponent(owner.email),
      )
    ).status === 404,
    'Resolver denies reverse lookup of another email',
  );
  check(
    (
      await holder.client.ok(
        '/api/v1/resolve?type=email&identifier=' + encodeURIComponent(holder.email),
      )
    ).profile.id === person.id,
    'Verified email resolver returns only the caller owned person',
  );
  check(
    (await anon.ok('/api/v1/resolve?type=native&identifier=' + person.id)).profile.id === person.id,
    'Native resolver projects permitted public fields',
  );
  const header = await upload(holder, source, 'HEADER'),
    oldHeader = await upload(holder, source, 'HEADER'),
    gallery = await upload(holder, source, 'GALLERY');
  check(
    (await asset(header)).status === 404,
    'Validated header stays private until explicit publication',
  );
  const mediaPath = '/api/v1/identities/' + source.id + '/media/';
  await holder.client.ok(mediaPath + oldHeader.id + '/publication', {
    method: 'PUT',
    body: { enabled: true },
  });
  await holder.client.ok(mediaPath + header.id + '/publication', {
    method: 'PUT',
    body: { enabled: true },
  });
  await holder.client.ok(mediaPath + oldHeader.id + '/publication', {
    method: 'PUT',
    body: { enabled: false },
  });
  check(
    (await anon.ok('/api/v1/profiles/' + source.id)).headerUrl.includes(header.id),
    'Revoking an older header preserves the currently selected header',
  );
  check(
    (await asset(header)).status === 200,
    'Published validated header delivers through the policy gate',
  );
  check(
    (
      await owner.client.request(mediaPath + header.id + '/publication', {
        method: 'PUT',
        body: { enabled: false },
      })
    ).status === 403,
    'Other accounts cannot change media publication',
  );
  await holder.client.ok(mediaPath + gallery.id + '/publication', {
    method: 'PUT',
    body: { enabled: true },
  });
  await holder.client.ok('/api/v1/identities/' + source.id + '/merge', {
    method: 'POST',
    body: {
      targetId: person.id,
      sourceConfirmation: source.handle,
      targetConfirmation: person.handle,
      proof: await holder.proof(),
    },
  });
  check(
    (await anon.ok('/api/v1/profiles/' + source.id)).id === person.id,
    'Merge with a selected header preserves canonical identity resolution',
  );
  check((await asset(gallery)).status === 404, 'Merge revokes source gallery publication');
  check(
    (await pg.query('SELECT identity_id,public_enabled FROM media WHERE id=$1', [header.id]))
      .rows[0].identity_id === person.id,
    'Merge transfers media ownership without a dangling header reference',
  );
  const did = await owner.client.ok('/api/v1/identities/' + organization.id + '/did/enable', {
    method: 'POST',
    body: { proof: await owner.proof() },
  });
  const assertion = await owner.client.ok(
    '/api/v1/organizations/' + organization.id + '/assertions',
    {
      method: 'POST',
      body: {
        subjectId: person.id,
        key: 'org:certification',
        value: 'credential-private-canary',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
  );
  await holder.client.ok(path + '/assertions/' + assertion.id + '/accept', {
    method: 'POST',
    body: { policy: priv },
  });
  const vc = await owner.client.ok('/api/v1/organizations/' + organization.id + '/credentials', {
      method: 'POST',
      body: { assertionId: assertion.id },
    }),
    grant = await oauth(
      holder,
      person,
      ['credential:' + vc.id],
      ['identity.read', 'credentials.read'],
    );
  const disclosed = await anon.ok('/api/v1/oauth/credentials', {
    headers: { Authorization: 'Bearer ' + grant.access_token },
  });
  check(
    disclosed.credentials.length === 1 && disclosed.credentials[0].id === vc.id,
    'OAuth discloses only the credential explicitly selected by the holder',
  );
  await compactVerify(
    disclosed.credentials[0].credential,
    await importJWK(did.verificationMethod[0].publicKeyJwk, 'EdDSA'),
  );
  check(true, 'Consented credential contains a verifiable EdDSA signature');
  const nativeApp = await holder.client.ok('/api/v1/applications', {
      method: 'POST',
      body: { name: 'Selected credential reader', purpose: 'Explicit holder disclosure' },
    }),
    nativeGrant = await holder.client.ok(path + '/consents', {
      method: 'POST',
      body: {
        applicationId: nativeApp.id,
        fields: ['credential:' + vc.id],
        scopes: ['credentials.read'],
      },
    });
  check(
    (
      await anon.ok('/api/v1/application/credentials', {
        headers: { Authorization: 'Bearer ' + nativeGrant.token },
      })
    ).credentials[0]?.id === vc.id,
    'Native consent discloses only the selected holder credential',
  );
  const noCredential = await oauth(
    holder,
    person,
    ['core:display_name'],
    ['identity.read', 'profile.basic'],
  );
  check(
    (
      await anon.request('/api/v1/oauth/credentials', {
        headers: { Authorization: 'Bearer ' + noCredential.access_token },
      })
    ).status === 401,
    'OAuth credential endpoint rejects a token without credentials.read',
  );
  const duplicate = await fetch(origin + '/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=authorization_code&grant_type=refresh_token',
  });
  check(
    duplicate.status === 400 && (await duplicate.json()).error === 'invalid_request',
    'OAuth token endpoint rejects duplicate form parameters',
  );
  await owner.client.ok(
    '/api/v1/organizations/' + organization.id + '/credentials/' + vc.id + '/revoke',
    { method: 'POST' },
  );
  check(
    (
      await anon.ok('/api/v1/oauth/credentials', {
        headers: { Authorization: 'Bearer ' + grant.access_token },
      })
    ).credentials.length === 0,
    'Credential revocation immediately removes OAuth disclosure',
  );
  const schemaKey = 'x-operations:member_code';
  check(
    (
      await holder.client.request('/api/v1/admin/schemas', {
        method: 'POST',
        body: {
          key: schemaKey,
          version: 1,
          type: 'text',
          title: 'Membership',
          description: 'A bounded operator registered membership code.',
        },
      })
    ).status === 403,
    'Schema registration requires an operator',
  );
  await modone.client.ok('/api/v1/admin/schemas', {
    method: 'POST',
    body: {
      key: schemaKey,
      version: 1,
      type: 'text',
      title: 'Membership',
      description: 'A bounded operator registered membership code.',
      maxLength: 20,
    },
  });
  check(
    (
      await holder.client.request(path + '/extensions', {
        method: 'PUT',
        body: { key: schemaKey, value: 5, policy: priv },
      })
    ).status === 400,
    'Registered extension rejects an incorrectly typed value',
  );
  await holder.client.ok(path + '/extensions', {
    method: 'PUT',
    body: { key: schemaKey, value: 'private-code-canary', policy: priv },
  });
  check(
    !JSON.stringify(await anon.ok('/api/v1/profiles/' + person.id)).includes('private-code-canary'),
    'Private extension value is absent from public profiles',
  );
  await holder.client.ok(path + '/extensions', {
    method: 'PUT',
    body: {
      key: schemaKey,
      value: 'public-schema-value',
      policy: { ...pub, indexable: false, searchable: false },
    },
  });
  check(
    (await anon.ok('/api/v1/profiles/' + person.id)).claims.some(
      (c) => c.value === 'public-schema-value',
    ),
    'Owner can explicitly publish a validated extension',
  );
  check(
    (
      await modone.client.request('/api/v1/admin/schemas', {
        method: 'POST',
        body: {
          key: schemaKey,
          version: 2,
          type: 'number',
          title: 'Membership',
          description: 'Incompatible change must be rejected by validation.',
        },
      })
    ).status === 409,
    'Incompatible schema upgrade is rejected',
  );
  await modone.client.ok('/api/v1/admin/schemas/' + encodeURIComponent(schemaKey), {
    method: 'DELETE',
  });
  check(
    !(await anon.ok('/api/v1/profiles/' + person.id)).claims.some((c) => c.key === schemaKey),
    'Schema revocation immediately removes published values',
  );
  await holder.client.ok(path + '/claims', {
    method: 'PUT',
    body: { key: 'core:website', value: 'https://blocked.example.test/path', policy: pub },
  });
  await modone.client.ok('/api/v1/admin/link-hosts', {
    method: 'POST',
    body: {
      host: 'example.test',
      reason: 'Synthetic malicious host evidence for the safety integration test.',
    },
  });
  check(
    !(await anon.ok('/api/v1/profiles/' + person.id)).claims.some((c) => c.key === 'core:website'),
    'Blocked parent domain removes clickable subdomain links',
  );
  await modone.client.ok('/api/v1/admin/link-hosts/example.test', { method: 'DELETE' });
  check(
    (await anon.ok('/api/v1/profiles/' + person.id)).claims.some((c) => c.key === 'core:website'),
    'Removing a block restores an otherwise permitted link',
  );
  const report = await owner.client.ok('/api/v1/reports', {
    method: 'POST',
    body: {
      identityId: person.id,
      category: 'OTHER',
      description: 'Synthetic case for independent moderation review.',
    },
  });
  await modone.client.ok('/api/v1/admin/reports/' + report.id, {
    method: 'POST',
    body: {
      state: 'RESOLVED',
      action: 'RESTRICT',
      reason: 'Restriction fixture with a recorded moderator reason.',
    },
  });
  check(
    (await anon.request('/api/v1/profiles/' + person.id)).status === 404,
    'Moderation restriction removes public access immediately',
  );
  const appeal = await holder.client.ok(path + '/appeals', {
    method: 'POST',
    body: {
      reportId: report.id,
      reason:
        'Independent review requested with synthetic evidence demonstrating that the restriction should be lifted.',
    },
  });
  check(
    (
      await modone.client.request('/api/v1/admin/appeals/' + appeal.id, {
        method: 'POST',
        body: {
          decision: 'OVERTURNED',
          reason: 'The original moderator cannot act as the independent appeal reviewer.',
        },
      })
    ).status === 403,
    'Original moderator cannot decide the appeal',
  );
  await modtwo.client.ok('/api/v1/admin/appeals/' + appeal.id, {
    method: 'POST',
    body: {
      decision: 'OVERTURNED',
      reason: 'Independent reviewer confirms the synthetic evidence and overturns the restriction.',
    },
  });
  check(
    (await pg.query('SELECT state,visibility FROM identities WHERE id=$1', [person.id])).rows[0]
      .visibility === 'PRIVATE',
    'Independent appeal restores privately',
  );
  const legacy = await identity(owner, 'legacy'),
    legacyPath = '/api/v1/identities/' + legacy.id;
  await owner.client.ok(legacyPath + '/legacy', {
    method: 'PUT',
    body: { custodianEmail: custodian.email, outcome: 'MEMORIALIZE', proof: await owner.proof() },
  });
  await custodian.client.ok('/api/v1/legacy/' + legacy.id + '/accept', { method: 'POST' });
  const request = await custodian.client.ok('/api/v1/legacy/' + legacy.id + '/request', {
    method: 'POST',
    body: {
      evidence: 'Synthetic independent legacy evidence. '.repeat(5),
      proof: await custodian.proof(),
    },
  });
  const reason =
    'Independent review of the synthetic evidence supports this explicit legacy policy.';
  await modone.client.ok('/api/v1/admin/legacy/' + request.id + '/review', {
    method: 'POST',
    body: { decision: 'APPROVE', reason, proof: await modone.proof() },
  });
  check(
    (
      await modone.client.request('/api/v1/admin/legacy/' + request.id + '/review', {
        method: 'POST',
        body: { decision: 'APPROVE', reason, proof: await modone.proof() },
      })
    ).status === 409,
    'One legacy reviewer cannot count twice',
  );
  await modtwo.client.ok('/api/v1/admin/legacy/' + request.id + '/review', {
    method: 'POST',
    body: { decision: 'APPROVE', reason, proof: await modtwo.proof() },
  });
  check(
    (
      await modtwo.client.request('/api/v1/admin/legacy/' + request.id + '/apply', {
        method: 'POST',
        body: { proof: await modtwo.proof() },
      })
    ).status === 409,
    'Two approvals do not bypass the 30-day legacy wait',
  );
  await pg.query("UPDATE legacy_requests SET not_before=now()-interval '1 second' WHERE id=$1", [
    request.id,
  ]);
  await modtwo.client.ok('/api/v1/admin/legacy/' + request.id + '/apply', {
    method: 'POST',
    body: { proof: await modtwo.proof() },
  });
  check(
    (
      await pg.query('SELECT state,evidence_encrypted FROM legacy_requests WHERE id=$1', [
        request.id,
      ])
    ).rows[0].evidence_encrypted === '',
    'Applied legacy request erases restricted evidence',
  );
  const memorialReport = await owner.client.ok('/api/v1/reports', {
    method: 'POST',
    body: {
      identityId: legacy.id,
      category: 'OTHER',
      description: 'Synthetic memorial lifecycle safety fixture.',
    },
  });
  check(
    (
      await modone.client.request('/api/v1/admin/reports/' + memorialReport.id, {
        method: 'POST',
        body: {
          state: 'RESOLVED',
          action: 'RESTORE',
          reason: 'Restoring moderation must preserve memorial lifecycle state.',
        },
      })
    ).status === 409,
    'Invalid moderator lifecycle transition is explicitly rejected',
  );
  check(
    (await pg.query('SELECT state FROM identities WHERE id=$1', [legacy.id])).rows[0].state ===
      'MEMORIALIZED',
    'Moderator restore preserves memorialized lifecycle state',
  );
  const destination = await peer('https://destination.example.test', modone.id),
    remoteSource = await peer('https://source.example.test', modone.id),
    migrating = await identity(holder, 'migrating'),
    target = destination.origin + '/api/v1/profiles/' + makeId('idn'),
    migratingPath = '/api/v1/identities/' + migrating.id + '/federation';
  await holder.client.ok(migratingPath, { method: 'PUT', body: { enabled: true } });
  const challenge = await holder.client.ok(migratingPath + '/migration/challenge', {
      method: 'POST',
      body: { target },
    }),
    signed = await acceptance(destination, challenge.source, target, challenge.nonce);
  const wrong = await acceptance(
    destination,
    challenge.source,
    target,
    challenge.nonce,
    'https://wrong.example.test',
  );
  check(
    (
      await holder.client.request(migratingPath + '/migration/complete', {
        method: 'POST',
        body: {
          target,
          acceptance: wrong,
          confirmHandle: migrating.handle,
          proof: await holder.proof(),
        },
      })
    ).status === 400,
    'Migration rejects an acceptance signed for the wrong node audience',
  );
  await holder.client.ok(migratingPath + '/migration/complete', {
    method: 'POST',
    body: {
      target,
      acceptance: signed,
      confirmHandle: migrating.handle,
      proof: await holder.proof(),
    },
  });
  check(
    (await pg.query('SELECT state,migrated_to FROM identities WHERE id=$1', [migrating.id])).rows[0]
      .migrated_to === target,
    'Destination signature and one-time source challenge complete migration',
  );
  check(
    (await anon.request('/api/v1/profiles/' + migrating.id)).status === 404,
    'Migrated source contents are archived privately',
  );
  check(
    (
      await holder.client.request(migratingPath + '/migration/complete', {
        method: 'POST',
        body: {
          target,
          acceptance: signed,
          confirmHandle: migrating.handle,
          proof: await holder.proof(),
        },
      })
    ).status >= 400,
    'Migration completion proof cannot be replayed',
  );
  const remoteActor = remoteSource.origin + '/api/v1/profiles/' + makeId('idn'),
    remoteTarget = destination.origin + '/api/v1/profiles/' + makeId('idn'),
    remoteAcceptance = await acceptance(
      destination,
      remoteActor,
      remoteTarget,
      randomBytes(24).toString('base64url'),
      remoteSource.origin,
    ),
    moveMessage = await activity(
      remoteSource,
      remoteActor,
      'Move',
      { target: remoteTarget, proof: remoteAcceptance, movedAt: new Date().toISOString() },
      4,
    );
  const incoming = await anon.request('/api/v1/federation/inbox', {
    method: 'POST',
    body: { message: moveMessage },
    headers: { Origin: remoteSource.origin },
  });
  check(
    incoming.status === 202,
    'Federation inbox verifies source message and separate destination migration signature',
  );
  check(
    (await anon.ok('/api/v1/federation/resolve?actor=' + encodeURIComponent(remoteActor)))
      .movedTo === remoteTarget,
    'Remote migration resolves to a verified destination alias',
  );
  await pg.query("UPDATE remote_profiles SET expires_at=now()-interval '1 day' WHERE actor=$1", [
    remoteActor,
  ]);
  check(
    (await anon.ok('/api/v1/federation/resolve?actor=' + encodeURIComponent(remoteActor)))
      .movedTo === remoteTarget,
    'Permanent migration alias survives ordinary profile cache expiry',
  );
  await modone.client.ok('/api/v1/admin/federation/peers/' + remoteSource.id, { method: 'DELETE' });
  check(
    (await anon.request('/api/v1/federation/resolve?actor=' + encodeURIComponent(remoteActor)))
      .status === 404,
    'Blocking the source node purges its migrated aliases',
  );
  const discovery = await anon.ok('/.well-known/identity-federation'),
    rotated = await modone.client.ok('/api/v1/admin/federation/keys/rotate', {
      method: 'POST',
      body: { proof: await modone.proof() },
    });
  check(
    rotated.fingerprint !== discovery.fingerprint &&
      rotated.document.verificationMethod.length === 2,
    'Operator key rotation changes the pin and retains the retired verification key',
  );
  check(
    !JSON.stringify(rotated.document).includes('private'),
    'Rotated node discovery never includes private key material',
  );
  await modone.client.ok(
    '/api/v1/admin/federation/keys/' + rotated.document.verificationMethod[0].id.split('#')[1],
    { method: 'DELETE', body: { proof: await modone.proof() } },
  );
  check(
    (await anon.ok('/.well-known/did.json')).verificationMethod.length === 1,
    'Revoked node keys disappear from discovery',
  );
  await holder.client.ok('/api/v1/notifications/preferences', {
    method: 'PUT',
    body: { inApp: false, email: false },
  });
  check(
    (await holder.client.ok('/api/v1/notifications')).length === 0,
    'Disabling in-app notifications erases prior notifications',
  );
  const removable = await account('removable'),
    owned = await identity(removable, 'owned'),
    shared = await identity(removable, 'shared');
  await pg.query("INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,'OWNER')", [
    shared.id,
    owner.id,
  ]);
  check(
    (
      await removable.client.request('/api/v1/account', {
        method: 'DELETE',
        body: {
          confirmEmail: owner.email,
          deleteOwnedIdentities: true,
          proof: await removable.proof(),
        },
      })
    ).status === 400,
    'Account deletion requires the exact current verified email',
  );
  await removable.client.ok('/api/v1/account', {
    method: 'DELETE',
    body: {
      confirmEmail: removable.email,
      deleteOwnedIdentities: true,
      proof: await removable.proof(),
    },
  });
  check(
    (await pg.query('SELECT state FROM identities WHERE id=$1', [owned.id])).rows[0].state ===
      'DELETED',
    'Account deletion purges solely owned identities',
  );
  check(
    (await pg.query('SELECT state FROM identities WHERE id=$1', [shared.id])).rows[0].state ===
      'ACTIVE',
    'Account deletion preserves identities with another owner',
  );
  check(
    (await removable.client.request('/api/v1/auth/me')).status === 401,
    'Deleted account session stops authenticating',
  );
  await (await import('./delivery-cache-checks.mjs')).cacheChecks();
  await (
    await import('./operations-additional.mjs')
  ).additional({
    oauth,
    holder,
    person,
    path,
    upload,
    asset,
    pg,
    anon,
    nativeApp,
    account,
    pace,
    prefix,
    password,
    identity,
    destination,
  });
  console.log('Operational integration passed ' + checks + ' checks.');
} finally {
  const keys = (await pg.query('SELECT source_key,variants FROM media')).rows.flatMap((m) => [
    m.source_key,
    ...Object.values(m.variants ?? {}),
  ]);
  const { deleteObject } = await import('../dist/packages/core/src/storage.js');
  for (const key of new Set(keys)) await deleteObject(key).catch(() => {});
  await redis.quit();
  const { closeRedis } = await import('../dist/packages/core/src/redis.js');
  await closeRedis();
  await pg.end();
}
