import * as OTPAuth from 'otpauth';
import { jwtVerify, importJWK, decodeProtectedHeader } from 'jose';
import { randomBytes } from 'node:crypto';
import { check, origin } from './test-client.mjs';
export async function additional({
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
  oauth,
}) {
  await holder.client.ok(path + '/settings', {
    method: 'PUT',
    body: { visibility: 'PUBLIC', searchable: true, indexable: true, machine: true, agent: false },
  });
  const raceHandle = prefix + 'race',
    race = await Promise.all(
      [0, 1].map(() =>
        holder.client.request('/api/v1/identities', {
          method: 'POST',
          body: {
            type: 'PERSON',
            handle: raceHandle,
            displayName: 'Concurrent handle fixture',
            visibility: 'PRIVATE',
          },
        }),
      ),
    );
  check(
    race.filter((r) => r.status === 201).length === 1 &&
      race.filter((r) => r.status === 409).length === 1,
    'Concurrent handle registration admits exactly one identity',
  );
  const block = await holder.client.ok(path + '/blocks', {
    method: 'POST',
    body: {
      kind: 'biography',
      title: 'Restorable private block',
      configuration: { text: 'Historical block contents' },
      enabled: true,
      policy: {
        visibility: 'PRIVATE',
        searchable: false,
        indexable: false,
        api: false,
        machine: false,
        agent: false,
        applications: [],
        transformation: 'FULL',
      },
    },
  });
  await holder.client.ok(path + '/blocks/' + block.id, { method: 'DELETE' });
  const revisions = await pg.query(
    "SELECT id FROM revisions WHERE identity_id=$1 AND snapshot->'blocks' @> $2::jsonb ORDER BY created_at DESC LIMIT 1",
    [person.id, JSON.stringify([{ id: block.id }])],
  );
  await holder.client.ok(path + '/revisions/' + revisions.rows[0].id + '/restore', {
    method: 'POST',
    body: { proof: await holder.proof() },
  });
  const restoredBlocks = await holder.client.ok(path + '/blocks'),
    restored = restoredBlocks.find((b) => b.title === 'Restorable private block');
  check(
    restored &&
      restored.id !== block.id &&
      !restored.enabled &&
      restored.policy.visibility === 'PRIVATE',
    'Revision restore recreates deleted blocks privately with new ownership-bound IDs',
  );
  const orderBlocks = await holder.client.ok(path + '/blocks'),
    ordered = orderBlocks.map((b) => b.id).reverse();
  await holder.client.ok(path + '/block-order', { method: 'POST', body: { ids: ordered } });
  check(
    JSON.stringify((await holder.client.ok(path + '/blocks')).map((b) => b.id)) ===
      JSON.stringify(ordered),
    'Block ordering changes the exact owned set atomically',
  );
  check(
    (
      await holder.client.request(path + '/block-order', {
        method: 'POST',
        body: { ids: [...ordered, ordered[0]] },
      })
    ).status === 400,
    'Duplicate block ordering is rejected',
  );
  check(
    (await holder.client.request(path + '/block-order', { method: 'POST', body: { ids: [] } }))
      .status === 409,
    'Stale block ordering cannot overwrite a newer set',
  );
  const logs = await holder.client.ok('/api/v1/applications/' + nativeApp.id + '/logs');
  check(
    logs.some((l) => l.operation === 'credentials') &&
      !JSON.stringify(logs).includes('credential-private-canary'),
    'Application diagnostics expose bounded access metadata without credential contents',
  );
  const baseAvatar = await upload(holder, person, 'AVATAR'),
    temporary = await upload(holder, person, 'AVATAR');
  await holder.client.ok(path + '/media/' + baseAvatar.id + '/activate', { method: 'PUT' });
  await (
    await import('./consented-avatar-checks.mjs')
  ).avatarChecks({ holder, person, path, baseAvatar, asset, nativeApp, oauth });
  const edited = await holder.client.ok(path + '/media/' + temporary.id + '/edit', {
    method: 'POST',
    body: {
      alt: 'Rotated transparent avatar',
      transforms: {
        rotation: 90,
        removeColor: '#8445cc',
        background: '#123456',
        focal: { x: 0.2, y: 0.8 },
        quality: 75,
      },
    },
  });
  let processed;
  for (let n = 0; n < 120; n++) {
    processed = (await holder.client.ok(path + '/media')).find((m) => m.id === edited.id);
    if (processed?.status === 'READY') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(
    processed?.status === 'READY' && processed.width === 30 && processed.height === 40,
    'Edited image is reprocessed as a new immutable normalized version',
  );
  const delivery = process.env.TEST_DELIVERY_ORIGIN,
    startsAt = new Date(Date.now() - 1000).toISOString(),
    endsAt = new Date(Date.now() + 60_000).toISOString();
  const selection = await holder.client.ok(path + '/avatar-selections', {
    method: 'POST',
    body: { mediaId: edited.id, startsAt, endsAt },
  });
  let avatar = await fetch(delivery + '/avatar/' + person.id, { redirect: 'manual' });
  check(
    avatar.headers.get('location')?.includes(edited.id),
    'Temporary avatar applies during its interval',
  );
  check(
    (await asset({ id: edited.id })).status === 200,
    'Active temporary avatar passes the current publication gate',
  );
  check(
    (
      await holder.client.request(path + '/avatar-selections', {
        method: 'POST',
        body: { mediaId: temporary.id, startsAt, endsAt },
      })
    ).status === 409,
    'Overlapping schedules are rejected under the identity lock',
  );
  await pg.query(
    "UPDATE avatar_selections SET starts_at=now()-interval '2 minutes',ends_at=now()-interval '1 minute' WHERE id=$1",
    [selection.id],
  );
  avatar = await fetch(delivery + '/avatar/' + person.id, { redirect: 'manual' });
  check(
    avatar.headers.get('location')?.includes(baseAvatar.id),
    'Temporary expiry restores the base avatar without scheduler dependence',
  );
  check(
    (await asset({ id: edited.id })).status === 404,
    'Expired temporary avatar stops public asset delivery',
  );
  const override = await holder.client.ok(path + '/avatar-selections', {
    method: 'POST',
    body: { mediaId: temporary.id, context: 'APPLICATION', applicationId: nativeApp.id, startsAt },
  });
  check(
    (
      await fetch(delivery + '/avatar/' + person.id + '?application=' + nativeApp.id, {
        redirect: 'manual',
      })
    ).headers
      .get('location')
      ?.includes(temporary.id),
    'Explicit application override resolves the selected avatar',
  );
  await holder.client.ok(path + '/avatar-selections/' + override.id, { method: 'DELETE' });
  check(
    (
      await fetch(delivery + '/avatar/' + person.id + '?application=' + nativeApp.id, {
        redirect: 'manual',
      })
    ).headers
      .get('location')
      ?.includes(baseAvatar.id),
    'Cancelling an override immediately restores the base avatar',
  );
  const preflight = await fetch(origin + '/api/v1/profiles/' + person.id, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://consumer.example.test',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization',
    },
  });
  check(
    preflight.status === 204 &&
      preflight.headers.get('access-control-allow-origin') === '*' &&
      !preflight.headers.has('access-control-allow-credentials'),
    'Browser SDK GET preflight supports explicit tokens without cross-origin cookies',
  );
  check(
    (
      await fetch(origin + '/api/v1/account/settings', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://consumer.example.test',
          'Access-Control-Request-Method': 'PATCH',
        },
      })
    ).status === 403,
    'Untrusted browser mutation preflight is denied',
  );
  const accountSecurity = await account('security'),
    newPassword = 'Replacement-account-security-password!2026',
    settingsClient = accountSecurity.client;
  await settingsClient.ok('/api/v1/account/settings', {
    method: 'PATCH',
    body: { locale: 'fa', timezone: 'Asia/Tehran' },
  });
  check(
    (await settingsClient.ok('/api/v1/auth/me')).locale === 'fa',
    'Account locale and timezone are saved',
  );
  await settingsClient.ok('/api/v1/account/password', {
    method: 'POST',
    body: { password: newPassword, proof: await accountSecurity.proof() },
  });
  check(
    (await settingsClient.request('/api/v1/auth/me')).status === 401,
    'Password change revokes the current session',
  );
  await pace();
  check(
    (
      await settingsClient.request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: accountSecurity.email, password },
      })
    ).status === 401,
    'Previous password stops authenticating',
  );
  await pace();
  await settingsClient.ok('/api/v1/auth/login', {
    method: 'POST',
    body: { email: accountSecurity.email, password: newPassword },
  });
  async function securityProof(code) {
    await pace();
    return (
      await settingsClient.ok('/api/v1/auth/stepup', {
        method: 'POST',
        body: { password: newPassword, ...(code ? { code } : {}) },
      })
    ).proof;
  }
  const changedEmail = prefix + 'newmail@example.test';
  await settingsClient.ok('/api/v1/account/email', {
    method: 'POST',
    body: { email: changedEmail, proof: await securityProof() },
  });
  let emailToken;
  for (let n = 0; n < 120 && !emailToken; n++) {
    const list = await fetch('http://localhost:8025/api/v1/messages').then((r) => r.json());
    for (const m of list.messages.filter((m) => m.To.some((t) => t.Address === changedEmail))) {
      const detail = await fetch('http://localhost:8025/api/v1/message/' + m.ID).then((r) =>
        r.json(),
      );
      emailToken = detail.Text.match(/confirm this code:\s+([A-Za-z0-9_-]{20,})/)?.[1];
      if (emailToken) break;
    }
    if (!emailToken) await new Promise((r) => setTimeout(r, 250));
  }
  check(Boolean(emailToken), 'Email change code is delivered through the real SMTP worker');
  check(
    (
      await holder.client.request('/api/v1/account/email/confirm', {
        method: 'POST',
        body: { token: emailToken },
      })
    ).status === 404,
    'Email verification code is bound to the requesting account',
  );
  await settingsClient.ok('/api/v1/account/email/confirm', {
    method: 'POST',
    body: { token: emailToken },
  });
  check(
    (await settingsClient.ok('/api/v1/auth/me')).email === changedEmail,
    'Confirmed email replaces the verified login address',
  );
  check(
    (
      await settingsClient.request('/api/v1/account/email/confirm', {
        method: 'POST',
        body: { token: emailToken },
      })
    ).status === 404,
    'Email verification code cannot be replayed',
  );
  const setup = await settingsClient.ok('/api/v1/auth/totp/setup', {
      method: 'POST',
      body: { proof: await securityProof() },
    }),
    totp = OTPAuth.URI.parse(setup.uri),
    codes = await settingsClient.ok('/api/v1/auth/totp/confirm', {
      method: 'POST',
      body: { token: setup.token, code: totp.generate() },
    });
  check(
    codes.backupCodes.length === 10,
    'Authenticator enrollment creates ten single-use backup codes',
  );
  const replacement = await settingsClient.ok('/api/v1/account/backup-codes', {
    method: 'POST',
    body: { proof: await securityProof(codes.backupCodes[0]) },
  });
  check(
    replacement.backupCodes.length === 10 && replacement.backupCodes[0] !== codes.backupCodes[0],
    'Backup code rotation replaces the entire previous set',
  );
  await pace();
  check(
    (
      await settingsClient.request('/api/v1/auth/stepup', {
        method: 'POST',
        body: { password: newPassword, code: codes.backupCodes[1] },
      })
    ).status === 401,
    'Old backup codes cannot authorize after rotation',
  );
  await settingsClient.ok('/api/v1/account/totp/disable', {
    method: 'POST',
    body: { proof: await securityProof(replacement.backupCodes[0]) },
  });
  check(
    (await settingsClient.ok('/api/v1/auth/me')).totp_enabled === false,
    'Authenticator removal clears its secret and backup codes',
  );
  const destinationLocal = await identity(holder, 'destlocal'),
    destPath = '/api/v1/identities/' + destinationLocal.id;
  await holder.client.ok(destPath + '/settings', {
    method: 'PUT',
    body: { visibility: 'PUBLIC', searchable: true, indexable: true, machine: true, agent: false },
  });
  await holder.client.ok(destPath + '/federation', { method: 'PUT', body: { enabled: true } });
  const sourceExternal =
      destination.origin + '/api/v1/profiles/idn_' + randomBytes(16).toString('hex'),
    nonce = randomBytes(24).toString('base64url'),
    accept = await holder.client.ok(destPath + '/federation/migration/accept', {
      method: 'POST',
      body: { source: sourceExternal, nonce, proof: await holder.proof() },
    });
  const nodeDocument = await anon.ok('/.well-known/did.json'),
    header = decodeProtectedHeader(accept.acceptance),
    key = nodeDocument.verificationMethod.find((k) => k.id === header.kid);
  const accepted = await jwtVerify(accept.acceptance, await importJWK(key.publicKeyJwk, 'EdDSA'), {
    issuer: nodeDocument.id,
    audience: destination.origin,
    algorithms: ['EdDSA'],
  });
  check(
    accepted.payload.source === sourceExternal &&
      accepted.payload.target === origin + '/api/v1/profiles/' + destinationLocal.id &&
      accepted.payload.nonce === nonce,
    'Destination acceptance HTTP endpoint signs the exact source, target, nonce and audience',
  );
}
