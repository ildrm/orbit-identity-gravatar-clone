import { createHash, randomBytes } from 'node:crypto';
import { Client, account, name, origin, check, checks } from './test-client.mjs';
const owner = await account('owner'),
  other = await account('other'),
  destination = await account('destination'),
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
  body: { type: 'PERSON', handle: name, displayName: 'OAuth public value', visibility: 'PUBLIC' },
});
const p = '/api/v1/identities/' + identity.id;
await owner.client.ok(p + '/claims', {
  method: 'PUT',
  body: { key: 'core:bio', value: 'private-oauth-canary', policy: priv },
});
const app = await owner.client.ok('/api/v1/oauth/clients', {
  method: 'POST',
  body: {
    name: 'Public OAuth fixture',
    purpose: 'Read selected profile fields',
    mode: 'PUBLIC',
    redirectUris: ['https://client.example/callback'],
  },
});
const metadata = await anon.ok('/.well-known/oauth-authorization-server');
check(
  metadata.code_challenge_methods_supported.join() === 'S256' &&
    !metadata.scopes_supported.includes('openid'),
  'OAuth metadata advertises only implemented grants and PKCE',
);
async function authorization(
  client = app,
  fields = 'core:display_name core:bio',
  selected = ['identity.read', 'profile.basic', 'offline_access'],
) {
  const verifier = randomBytes(32).toString('base64url'),
    challenge = createHash('sha256').update(verifier).digest('base64url'),
    state = randomBytes(20).toString('hex');
  const parameters = {
    client_id: client.client_id,
    response_type: 'code',
    redirect_uri: 'https://client.example/callback',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: selected.join(' '),
    fields,
  };
  const r = await owner.client.request(
    '/api/v1/oauth/authorize?' + new URLSearchParams(parameters),
    { redirect: 'manual' },
  );
  check(r.status === 302, 'OAuth authorization opens local consent');
  const requestId = new URL(r.headers.get('location')).searchParams.get('request');
  return { requestId, verifier, state, parameters };
}
async function decision(
  auth,
  scopes = ['identity.read', 'profile.basic', 'offline_access'],
  fields = ['core:display_name', 'core:bio'],
  extra = {},
) {
  const result = await owner.client.ok('/api/v1/oauth/requests/' + auth.requestId + '/decision', {
    method: 'POST',
    body: { approve: true, identityId: identity.id, scopes, fields, ...extra },
  });
  const callback = new URL(result.redirect);
  check(
    callback.searchParams.get('state') === auth.state &&
      callback.searchParams.get('iss') === process.env.PUBLIC_ORIGIN,
    'OAuth callback preserves state and identifies issuer',
  );
  return callback.searchParams.get('code');
}
async function token(body, client = app) {
  const response = await fetch(origin + '/api/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(client.client_secret
        ? {
            Authorization:
              'Basic ' +
              Buffer.from(client.client_id + ':' + client.client_secret).toString('base64'),
          }
        : {}),
    },
    body: new URLSearchParams({ ...body, client_id: client.client_id }),
  });
  return { status: response.status, data: await response.json() };
}
async function profile(access) {
  return anon.request('/api/v1/oauth/profile', { headers: { Authorization: 'Bearer ' + access } });
}
let auth = await authorization();
check(
  (await other.client.request('/api/v1/oauth/requests/' + auth.requestId)).status === 404,
  'Consent requests are bound to the signed-in account',
);
check(
  (
    await owner.client.request('/api/v1/oauth/requests/' + auth.requestId + '/decision', {
      method: 'POST',
      body: {
        approve: true,
        identityId: identity.id,
        scopes: ['profile.professional'],
        fields: [],
      },
    })
  ).status === 400,
  'Consent cannot increase requested scopes',
);
const code = await decision(auth);
check(
  (
    await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: auth.parameters.redirect_uri,
      code_verifier: 'x'.repeat(43),
    })
  ).data.error === 'invalid_grant',
  'Authorization exchange rejects the wrong PKCE verifier',
);
let result = await token({
  grant_type: 'authorization_code',
  code,
  redirect_uri: auth.parameters.redirect_uri,
  code_verifier: auth.verifier,
});
check(
  result.status === 200 && result.data.refresh_token && result.data.expires_in <= 900,
  'Standard form token endpoint works without a session or trusted Origin',
);
const originalRefresh = result.data.refresh_token,
  originalAccess = result.data.access_token;
let resource = await profile(originalAccess);
check(
  resource.status === 200 &&
    resource.data.displayName === 'OAuth public value' &&
    !JSON.stringify(resource.data).includes('private-oauth-canary'),
  'OAuth resource intersects scopes, selected fields and private claim policy',
);
result = await token({ grant_type: 'refresh_token', refresh_token: originalRefresh });
check(
  result.status === 200 && result.data.refresh_token !== originalRefresh,
  'Refresh tokens rotate on use',
);
const rotatedAccess = result.data.access_token;
check(
  (await token({ grant_type: 'refresh_token', refresh_token: originalRefresh })).data.error ===
    'invalid_grant',
  'Replayed refresh token is rejected',
);
check(
  (await profile(rotatedAccess)).status === 401 && (await profile(originalAccess)).status === 401,
  'Refresh replay revokes the whole consent token family',
);
auth = await authorization();
const secondCode = await decision(auth);
result = await token({
  grant_type: 'authorization_code',
  code: secondCode,
  redirect_uri: auth.parameters.redirect_uri,
  code_verifier: auth.verifier,
});
const access = result.data.access_token;
check(
  (
    await token({
      grant_type: 'authorization_code',
      code: secondCode,
      redirect_uri: auth.parameters.redirect_uri,
      code_verifier: auth.verifier,
    })
  ).data.error === 'invalid_grant' && (await profile(access)).status === 401,
  'Authorization-code replay revokes issued access',
);
auth = await authorization();
const deny = await owner.client.ok('/api/v1/oauth/requests/' + auth.requestId + '/decision', {
  method: 'POST',
  body: { approve: false },
});
check(
  new URL(deny.redirect).searchParams.get('error') === 'access_denied' &&
    new URL(deny.redirect).searchParams.get('state') === auth.state,
  'Explicit consent denial returns a state-bound OAuth error',
);
check(
  (
    await owner.client.request(
      '/api/v1/oauth/authorize?' +
        new URLSearchParams({
          ...auth.parameters,
          redirect_uri: 'https://attacker.example/callback',
        }),
      { redirect: 'manual' },
    )
  ).status === 400,
  'Unregistered OAuth redirect does not redirect the browser',
);
const confidential = await owner.client.ok('/api/v1/oauth/clients', {
  method: 'POST',
  body: {
    name: 'Confidential fixture',
    purpose: 'Server profile access',
    mode: 'CONFIDENTIAL',
    redirectUris: ['https://client.example/callback'],
  },
});
check(
  (
    await token(
      { grant_type: 'refresh_token', refresh_token: 'missing' },
      { ...confidential, client_secret: undefined },
    )
  ).status === 401,
  'Confidential clients require their own client secret',
);
auth = await authorization(confidential, 'core:display_name', ['identity.read', 'profile.basic']);
const confidentialCode = await decision(
  auth,
  ['identity.read', 'profile.basic'],
  ['core:display_name'],
);
result = await token(
  {
    grant_type: 'authorization_code',
    code: confidentialCode,
    redirect_uri: auth.parameters.redirect_uri,
    code_verifier: auth.verifier,
  },
  confidential,
);
check(
  result.status === 200 && !result.data.refresh_token,
  'Confidential Basic authentication succeeds and offline access is not implicit',
);
const revoke = await fetch(origin + '/api/v1/oauth/revoke', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization:
      'Basic ' +
      Buffer.from(confidential.client_id + ':' + confidential.client_secret).toString('base64'),
  },
  body: new URLSearchParams({ token: result.data.access_token }),
});
check(
  revoke.status === 200 && (await profile(result.data.access_token)).status === 401,
  'RFC 7009 token revocation immediately blocks the resource',
);
const org = await other.client.ok('/api/v1/identities', {
  method: 'POST',
  body: {
    type: 'ORGANIZATION',
    handle: name + '_org',
    displayName: 'Issuer fixture',
    visibility: 'PUBLIC',
  },
});
const assertion = await other.client.ok('/api/v1/organizations/' + org.id + '/assertions', {
  method: 'POST',
  body: {
    subjectId: identity.id,
    key: 'professional:job_title',
    value: 'Organization asserted title',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  },
});
check(
  !JSON.stringify(await anon.ok('/api/v1/profiles/' + identity.id)).includes(
    'Organization asserted title',
  ),
  'Unaccepted enterprise assertion is absent from public profile',
);
check(
  (
    await other.client.request(p + '/assertions/' + assertion.id + '/accept', {
      method: 'POST',
      body: { policy: pub },
    })
  ).status === 403,
  'Issuer cannot accept its assertion for the recipient',
);
await owner.client.ok(p + '/assertions/' + assertion.id + '/accept', {
  method: 'POST',
  body: { policy: priv },
});
check(
  !JSON.stringify(await anon.ok('/api/v1/profiles/' + identity.id)).includes(
    'Organization asserted title',
  ),
  'Recipient can accept an assertion privately',
);
await owner.client.ok(p + '/assertions/' + assertion.id + '/accept', {
  method: 'POST',
  body: { policy: pub },
});
check(
  (await anon.ok('/api/v1/profiles/' + identity.id)).claims.some(
    (c) => c.value === 'Organization asserted title' && c.verification === 'ISSUER_VERIFIED',
  ),
  'Recipient publication preserves issuer provenance',
);
await other.client.ok(
  '/api/v1/organizations/' + org.id + '/assertions/' + assertion.id + '/revoke',
  { method: 'POST' },
);
check(
  !JSON.stringify(await anon.ok('/api/v1/profiles/' + identity.id)).includes(
    'Organization asserted title',
  ) && (await anon.ok('/api/v1/profiles/' + identity.id)).id === identity.id,
  'Issuer revocation removes only its assertion and preserves recipient identity',
);
const source = await owner.client.ok('/api/v1/identities', {
  method: 'POST',
  body: {
    type: 'PERSON',
    handle: name + '_source',
    displayName: 'Source conflicting name',
    visibility: 'PRIVATE',
  },
});
const persona = await owner.client.ok('/api/v1/identities/' + source.id + '/personas', {
  method: 'POST',
  body: { name: 'Source context', slug: 'professional' },
});
await owner.client.ok('/api/v1/identities/' + source.id + '/claims', {
  method: 'PUT',
  body: { key: 'core:pronouns', value: 'Source private identity public field', policy: pub },
});
await owner.client.ok('/api/v1/identities/' + source.id + '/claims', {
  method: 'PUT',
  body: { key: 'core:bio', value: 'Source persona value', personaId: persona.id, policy: priv },
});
const preview = await owner.client.ok(
  '/api/v1/identities/' + source.id + '/merge-preview?target=' + identity.id,
);
check(
  preview.conflicts.some((c) => c.key === 'core:display_name'),
  'Merge preview identifies actual selected-claim conflicts',
);
check(
  (
    await other.client.request(
      '/api/v1/identities/' + source.id + '/merge-preview?target=' + identity.id,
    )
  ).status === 403,
  'Merge requires control of both identities',
);
await owner.client.ok('/api/v1/identities/' + source.id + '/merge', {
  method: 'POST',
  body: {
    targetId: identity.id,
    sourceConfirmation: source.handle,
    targetConfirmation: identity.handle,
    proof: await owner.proof(),
  },
});
check(
  (await anon.request('/api/v1/profiles/' + source.id)).status === 404,
  'Private merged identity does not become publicly resolvable',
);
check(
  (await owner.client.ok(p)).displayName === 'OAuth public value',
  'Target selected claim survives a conflicting merge',
);
const sourceClaims = await owner.client.ok(p + '/claims');
check(
  sourceClaims.some(
    (c) =>
      c.value === 'Source conflicting name' && !c.selected && c.metadata.mergedFrom === source.id,
  ),
  'Conflicting source claim is preserved with merge provenance',
);
check(
  sourceClaims.some(
    (c) => c.value === 'Source private identity public field' && c.policy.visibility === 'PRIVATE',
  ),
  'Merge constrains source claims by effective identity privacy',
);
const personae = await owner.client.ok(p + '/personas');
check(
  personae.some((p) => p.id === persona.id),
  'Merge preserves persona IDs and composite ownership constraints',
);
await owner.client.ok(p + '/settings', {
  method: 'PUT',
  body: {
    visibility: 'PUBLIC',
    searchable: true,
    indexable: true,
    machine: true,
    agent: false,
    contactEnabled: false,
    theme: 'light',
    locale: 'en',
  },
});
const alias = await anon.ok('/api/v1/profiles/' + source.handle);
check(
  alias.id === identity.id &&
    alias.canonicalHandle === identity.handle &&
    !JSON.stringify(alias).includes('Source private identity public field'),
  'Old handles resolve to the surviving identity without exposing formerly private fields',
);
const sourceHtml = await fetch(origin + '/u/' + source.handle, { redirect: 'manual' });
check(
  sourceHtml.status === 308 && sourceHtml.headers.get('location').endsWith('/u/' + identity.handle),
  'Merged profile HTML permanently redirects to the canonical handle',
);
const ticket = (
  await owner.client.ok('/api/v1/auth/merge-ticket', {
    method: 'POST',
    body: { targetEmail: destination.email, proof: await owner.proof() },
  })
).ticket;
check(
  (
    await other.client.request('/api/v1/auth/merge', {
      method: 'POST',
      body: { ticket, proof: await other.proof(), confirmation: 'MERGE ACCOUNTS' },
    })
  ).status === 403,
  'Account merge ticket is bound to the verified destination account',
);
await destination.client.ok('/api/v1/auth/merge', {
  method: 'POST',
  body: { ticket, proof: await destination.proof(), confirmation: 'MERGE ACCOUNTS' },
});
check(
  (await owner.client.request('/api/v1/auth/me')).status === 401 &&
    (await destination.client.request('/api/v1/auth/me')).status === 401,
  'Account merge revokes both accounts sessions',
);
check(
  (
    await owner.client.request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: owner.email, password: owner.password },
    })
  ).status === 401,
  'Merged source account cannot sign in',
);
await destination.client.ok('/api/v1/auth/login', {
  method: 'POST',
  body: { email: destination.email, password: destination.password },
});
check(
  (await destination.client.ok('/api/v1/identities')).some(
    (i) => i.id === identity.id && i.role === 'OWNER',
  ),
  'Destination account receives the proved source ownership',
);
check(
  (await destination.client.ok('/api/v1/applications')).some((a) => a.id === app.client_id),
  'Application ownership follows account merge',
);
await destination.client.ok(p, { method: 'DELETE', body: { confirmation: identity.handle } });
await other.client.ok('/api/v1/identities/' + org.id, {
  method: 'DELETE',
  body: { confirmation: org.handle },
});
process.stdout.write(JSON.stringify({ status: 'passed', checks }) + '\n');
