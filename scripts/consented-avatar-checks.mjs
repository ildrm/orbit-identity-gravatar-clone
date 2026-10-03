import assert from 'node:assert/strict';
import { check, origin } from './test-client.mjs';
export async function avatarChecks({ holder, person, path, baseAvatar, asset, nativeApp, oauth }) {
  await holder.client.ok(path + '/media/' + baseAvatar.id + '/activate', { method: 'PUT' });
  const publicSettings = {
    visibility: 'PUBLIC',
    searchable: true,
    indexable: true,
    machine: true,
    agent: false,
  };
  await holder.client.ok(path + '/settings', {
    method: 'PUT',
    body: { ...publicSettings, visibility: 'PRIVATE' },
  });
  check(
    (await asset(baseAvatar)).status === 404,
    'Private identity denies public asset access before grant delivery',
  );
  const grant = await holder.client.ok(path + '/consents', {
    method: 'POST',
    body: { applicationId: nativeApp.id, scopes: ['identity.read', 'avatar.read'], fields: [] },
  });
  const tokenHeaders = { Authorization: 'Bearer ' + grant.token };
  const image = await fetch(origin + '/api/v1/application/avatar?size=128&format=webp', {
    headers: tokenHeaders,
  });
  const bytes = Buffer.from(await image.arrayBuffer());
  check(
    image.status === 200 &&
      image.headers.get('content-type')?.startsWith('image/webp') &&
      bytes.length > 20,
    'Current native avatar.read consent delivers actual private image bytes',
  );
  check(
    image.headers.get('cache-control') === 'no-store' &&
      image.headers.get('vary')?.includes('Authorization'),
    'Private consent avatar has no-store authorization-dependent cache headers',
  );
  const missing = await fetch(origin + '/api/v1/application/avatar');
  check(missing.status === 401, 'Anonymous private-avatar request is denied');
  const narrow = await holder.client.ok(path + '/consents', {
    method: 'POST',
    body: {
      applicationId: nativeApp.id,
      scopes: ['identity.read', 'profile.basic'],
      fields: ['core:display_name'],
    },
  });
  check(
    (
      await fetch(origin + '/api/v1/application/avatar', {
        headers: { Authorization: 'Bearer ' + narrow.token },
      })
    ).status === 401,
    'A profile-only grant cannot read private avatar bytes',
  );
  check(
    (await fetch(origin + '/api/v1/application/avatar?size=90000', { headers: tokenHeaders }))
      .status === 400,
    'Consented avatar enforces bounded output sizes',
  );
  const persona = await holder.client.ok(path + '/personas', {
    method: 'POST',
    body: { name: 'Private avatar persona', slug: 'privateavatar' },
  });
  const scoped = await holder.client.ok(path + '/consents', {
    method: 'POST',
    body: {
      applicationId: nativeApp.id,
      personaId: persona.id,
      scopes: ['identity.read', 'avatar.read'],
      fields: [],
    },
  });
  check(
    (
      await fetch(origin + '/api/v1/application/avatar', {
        headers: { Authorization: 'Bearer ' + scoped.token },
      })
    ).status === 200,
    'Active selected persona may use its authorized base avatar fallback',
  );
  await holder.client.ok(path + '/consents/' + scoped.id, { method: 'DELETE' });
  check(
    (
      await fetch(origin + '/api/v1/application/avatar', {
        headers: { Authorization: 'Bearer ' + scoped.token },
      })
    ).status === 401,
    'Revoked persona avatar grant immediately denies another read',
  );
  const issued = await oauth(holder, person, [], ['identity.read', 'avatar.read']);
  const oauthImage = await fetch(origin + '/api/v1/oauth/avatar?size=128&format=png', {
    headers: { Authorization: 'Bearer ' + issued.access_token },
  });
  assert.ok((await oauthImage.arrayBuffer()).byteLength > 20);
  check(
    oauthImage.status === 200 && oauthImage.headers.get('cache-control') === 'no-store',
    'Actual PKCE-issued OAuth access token delivers a private avatar',
  );
  check(
    (
      await fetch(origin + '/api/v1/application/avatar', {
        headers: { Authorization: 'Bearer ' + issued.access_token },
      })
    ).status === 401,
    'OAuth avatar token cannot be confused with a native grant',
  );
  await holder.client.ok(path + '/consents/' + grant.id, { method: 'DELETE' });
  check(
    (await fetch(origin + '/api/v1/application/avatar', { headers: tokenHeaders })).status === 401,
    'Revoked native avatar grant immediately denies subsequent bytes',
  );
  await holder.client.ok(path + '/settings', { method: 'PUT', body: publicSettings });
}
