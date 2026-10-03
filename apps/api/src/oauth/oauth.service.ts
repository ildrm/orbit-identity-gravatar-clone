import { applicationAccess } from '../../../../packages/core/src/application-access.js';
import { credentialsForGrant } from '../../../../packages/core/src/consented-credentials.js';
import { Injectable, Inject } from '@nestjs/common';
import { query, transaction, type DB } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { audit, event } from '../../../../packages/core/src/events.js';
import { config } from '../../../../packages/core/src/config.js';
import {
  OAuthError,
  oauthClientSchema,
  oauthDecisionSchema,
  parseAuthorization,
  matchesPkce,
  matchesSecret,
} from '../../../../packages/core/src/oauth.js';
import { IdentityService } from '../identity/identity.service.js';
import { ApplicationsService } from '../applications/applications.service.js';
interface Client {
  id: string;
  name: string;
  purpose: string;
  redirect_uris: string[];
  oauth_mode: string;
  oauth_secret_digest: string | null;
}
interface Grant {
  id: string;
  identity_id: string;
  application_id: string;
  account_id: string;
  persona_id: string | null;
  slug: string | null;
  scopes: string[];
  fields: string[];
  expires_at: Date;
}
@Injectable()
export class OAuthService {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
  ) {}
  async client(clientId: string, db?: DB): Promise<Client> {
    const [client] = await query<Client>(
      'SELECT * FROM applications WHERE id=$1 AND oauth_mode IS NOT NULL AND revoked_at IS NULL',
      [clientId],
      db,
    );
    if (!client) throw new OAuthError('invalid_client', 'OAuth client unavailable.', 401);
    return client;
  }
  async create(accountId: string, input: unknown, requestId: string) {
    const d = oauthClientSchema.parse(input),
      clientId = id('app'),
      clientSecret = d.mode === 'CONFIDENTIAL' ? secret() : null;
    await transaction(async (db) => {
      if (
        !(
          await query(
            "SELECT 1 FROM accounts WHERE id=$1 AND state='ACTIVE' FOR UPDATE",
            [accountId],
            db,
          )
        ).length
      )
        throw new OAuthError('access_denied', 'Account unavailable.', 403);
      if (
        (
          await query(
            'SELECT 1 FROM applications WHERE account_id=$1 AND revoked_at IS NULL OFFSET 99 LIMIT 1',
            [accountId],
            db,
          )
        ).length
      )
        throw new OAuthError(
          'invalid_request',
          'Revoke unused applications before registering another.',
        );
      await query(
        'INSERT INTO applications(id,account_id,name,purpose,redirect_uris,oauth_mode,oauth_secret_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          clientId,
          accountId,
          d.name,
          d.purpose,
          JSON.stringify(d.redirectUris),
          d.mode,
          clientSecret ? digest(clientSecret) : null,
        ],
        db,
      );
      await audit(db, accountId, null, 'oauth.client_created', requestId, {
        applicationId: clientId,
        mode: d.mode,
      });
    });
    return {
      client_id: clientId,
      client_secret: clientSecret,
      token_endpoint_auth_method: d.mode === 'PUBLIC' ? 'none' : 'client_secret_basic',
      redirect_uris: d.redirectUris,
    };
  }
  async rotate(accountId: string, clientId: string, requestId: string) {
    const value = secret();
    await transaction(async (db) => {
      const rows = await query(
        "UPDATE applications SET oauth_secret_digest=$1 WHERE id=$2 AND account_id=$3 AND oauth_mode='CONFIDENTIAL' AND revoked_at IS NULL RETURNING id",
        [digest(value), clientId, accountId],
        db,
      );
      if (!rows.length)
        throw new OAuthError('invalid_client', 'Confidential client unavailable.', 403);
      await query(
        'UPDATE consents SET revoked_at=now() WHERE application_id=$1 AND protocol=$2',
        [clientId, 'OAUTH'],
        db,
      );
      await audit(db, accountId, null, 'oauth.client_rotated', requestId, {
        applicationId: clientId,
      });
    });
    return { client_secret: value };
  }
  async begin(accountId: string, input: Record<string, unknown>) {
    const client = await this.client(typeof input.client_id === 'string' ? input.client_id : '');
    const d = parseAuthorization(input, client.redirect_uris),
      requestId = id('oar');
    await query(
      "INSERT INTO oauth_requests(id,account_id,application_id,redirect_uri,state,challenge,scopes,fields,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')",
      [
        requestId,
        accountId,
        client.id,
        d.redirect_uri,
        d.state,
        d.code_challenge,
        JSON.stringify(d.scopes),
        JSON.stringify(d.fields),
      ],
    );
    return config().PUBLIC_ORIGIN + '/oauth/consent?request=' + requestId;
  }
  async details(accountId: string, requestId: string) {
    const [r] = await query<{
      id: string;
      application_id: string;
      redirect_uri: string;
      scopes: string[];
      fields: string[];
    }>(
      'SELECT id,application_id,redirect_uri,scopes,fields FROM oauth_requests WHERE id=$1 AND account_id=$2 AND used_at IS NULL AND expires_at>now()',
      [requestId, accountId],
    );
    if (!r)
      throw new OAuthError('invalid_request', 'Authorization request expired or unavailable.', 404);
    const a = await this.client(r.application_id);
    return {
      ...r,
      application: { id: a.id, name: a.name, purpose: a.purpose },
      identities: await this.identities.list(accountId),
    };
  }
  async decide(accountId: string, requestId: string, input: unknown, auditRequestId: string) {
    const d = oauthDecisionSchema.parse(input);
    return transaction(async (db) => {
      const [r] = await query<{
        id: string;
        application_id: string;
        redirect_uri: string;
        state: string;
        challenge: string;
        scopes: string[];
        fields: string[];
      }>(
        'SELECT * FROM oauth_requests WHERE id=$1 AND account_id=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE',
        [requestId, accountId],
        db,
      );
      if (!r)
        throw new OAuthError('invalid_request', 'Authorization request expired or unavailable.');
      const client = await this.client(r.application_id, db);
      const callback = new URL(r.redirect_uri);
      callback.searchParams.set('state', r.state);
      callback.searchParams.set('iss', config().PUBLIC_ORIGIN);
      if (!d.approve) {
        callback.searchParams.set('error', 'access_denied');
        await query('UPDATE oauth_requests SET used_at=now() WHERE id=$1', [r.id], db);
        return { redirect: callback.href };
      }
      if (!d.identityId) throw new OAuthError('invalid_request', 'Choose an identity.');
      const identity = await this.identities.authorize(accountId, d.identityId, 'security', db);
      if (identity.state !== 'ACTIVE')
        throw new OAuthError('access_denied', 'Identity is not active.', 403);
      const grantedScopes = [...new Set(d.scopes)],
        fields = [...new Set(d.fields)];
      if (
        !grantedScopes.length ||
        grantedScopes.some((s) => !r.scopes.includes(s)) ||
        fields.some((f) => !r.fields.includes(f))
      )
        throw new OAuthError('invalid_scope', 'Consent must be a subset of the request.');
      if (d.shareEmail && !grantedScopes.includes('email.read'))
        throw new OAuthError('invalid_scope', 'Email sharing requires email.read.');
      if (
        d.personaId &&
        !(
          await query(
            'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
            [d.personaId, d.identityId],
            db,
          )
        ).length
      )
        throw new OAuthError('invalid_request', 'Persona unavailable.');
      const consentId = id('cns'),
        code = secret(),
        expiry = new Date(Date.now() + d.days * 86400000);
      await query(
        "INSERT INTO consents(id,identity_id,application_id,persona_id,scopes,fields,token_digest,expires_at,account_id,purpose,protocol) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OAUTH')",
        [
          consentId,
          d.identityId,
          client.id,
          d.personaId,
          JSON.stringify(grantedScopes),
          JSON.stringify([...fields, ...(d.shareEmail ? ['account:email'] : [])]),
          digest(secret()),
          expiry,
          accountId,
          client.purpose,
        ],
        db,
      );
      await query(
        "INSERT INTO oauth_codes(digest,application_id,consent_id,redirect_uri,challenge,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '60 seconds')",
        [digest(code), client.id, consentId, r.redirect_uri, r.challenge],
        db,
      );
      await query('UPDATE oauth_requests SET used_at=now() WHERE id=$1', [r.id], db);
      await event(db, d.identityId, accountId, 'consent.updated', auditRequestId, {
        consentId,
        protocol: 'OAUTH',
      });
      callback.searchParams.set('code', code);
      return { redirect: callback.href };
    });
  }
  async authenticateClient(body: Record<string, unknown>, authorization?: string) {
    let clientId = typeof body.client_id === 'string' ? body.client_id : '',
      clientSecret: string | undefined;
    if (authorization) {
      if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization))
        throw new OAuthError('invalid_client', 'Use HTTP Basic client authentication.', 401);
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'),
        colon = decoded.indexOf(':');
      if (colon < 1) throw new OAuthError('invalid_client', 'Invalid client authentication.', 401);
      try {
        const basicId = decodeURIComponent(decoded.slice(0, colon).replaceAll('+', ' '));
        clientSecret = decodeURIComponent(decoded.slice(colon + 1).replaceAll('+', ' '));
        if (clientId && clientId !== basicId) throw new Error();
        clientId = basicId;
      } catch {
        throw new OAuthError('invalid_client', 'Invalid client authentication.', 401);
      }
    }
    const client = await this.client(clientId);
    if (
      client.oauth_mode === 'CONFIDENTIAL' &&
      (!clientSecret || !matchesSecret(clientSecret, client.oauth_secret_digest))
    )
      throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    if (client.oauth_mode === 'PUBLIC' && (authorization || body.client_secret !== undefined))
      throw new OAuthError(
        'invalid_client',
        'Public clients use PKCE without a client secret.',
        401,
      );
    return client;
  }
  private async activeGrant(consentId: string, db?: DB): Promise<Grant | undefined> {
    return (
      await query<Grant>(
        "SELECT c.*,p.slug FROM consents c JOIN applications a ON a.id=c.application_id JOIN accounts ac ON ac.id=c.account_id JOIN identities i ON i.id=c.identity_id JOIN memberships m ON m.identity_id=i.id AND m.account_id=c.account_id AND m.role='OWNER' LEFT JOIN personas p ON p.id=c.persona_id WHERE c.id=$1 AND c.protocol='OAUTH' AND c.revoked_at IS NULL AND c.expires_at>now() AND a.revoked_at IS NULL AND ac.state='ACTIVE' AND i.state='ACTIVE' AND (c.persona_id IS NULL OR p.active)",
        [consentId],
        db,
      )
    )[0];
  }
  private async issue(db: DB, grant: Grant, requestedScopes: string[]) {
    const access = 'oa_' + secret(),
      refresh = requestedScopes.includes('offline_access') ? 'or_' + secret() : null;
    const lifetime = Math.min(
      900,
      Math.floor((new Date(grant.expires_at).getTime() - Date.now()) / 1000),
    );
    await query(
      "INSERT INTO oauth_tokens(digest,consent_id,kind,scopes,expires_at) VALUES($1,$2,'ACCESS',$3,now()+$4*interval '1 second')",
      [digest(access), grant.id, JSON.stringify(requestedScopes), lifetime],
      db,
    );
    if (refresh)
      await query(
        "INSERT INTO oauth_tokens(digest,consent_id,kind,scopes,expires_at) VALUES($1,$2,'REFRESH',$3,$4)",
        [digest(refresh), grant.id, JSON.stringify(requestedScopes), grant.expires_at],
        db,
      );
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: lifetime,
      scope: requestedScopes.join(' '),
      ...(refresh ? { refresh_token: refresh } : {}),
    };
  }
  async token(body: Record<string, unknown>, authorization?: string) {
    const client = await this.authenticateClient(body, authorization);
    if (body.grant_type === 'authorization_code') {
      const result = await transaction(async (db) => {
        const [code] = await query<{
          consent_id: string;
          redirect_uri: string;
          challenge: string;
          used_at: Date | null;
          expires_at: Date;
        }>(
          'SELECT * FROM oauth_codes WHERE digest=$1 AND application_id=$2 FOR UPDATE',
          [digest(String(body.code ?? '')), client.id],
          db,
        );
        if (
          !code ||
          code.redirect_uri !== body.redirect_uri ||
          !matchesPkce(String(body.code_verifier ?? ''), code.challenge)
        )
          return { error: 'invalid_grant' } as const;
        if (code.used_at) {
          await query('UPDATE consents SET revoked_at=now() WHERE id=$1', [code.consent_id], db);
          return { error: 'invalid_grant' } as const;
        }
        if (new Date(code.expires_at).getTime() <= Date.now())
          return { error: 'invalid_grant' } as const;
        const grant = await this.activeGrant(code.consent_id, db);
        if (!grant) return { error: 'invalid_grant' } as const;
        await query(
          'UPDATE oauth_codes SET used_at=now() WHERE digest=$1',
          [digest(String(body.code))],
          db,
        );
        return this.issue(db, grant, grant.scopes);
      });
      if ('error' in result)
        throw new OAuthError('invalid_grant', 'Authorization code unavailable.');
      return result;
    }
    if (body.grant_type === 'refresh_token') {
      const result = await transaction(async (db) => {
        const [token] = await query<{
          consent_id: string;
          scopes: string[];
          used_at: Date | null;
          revoked_at: Date | null;
          expires_at: Date;
        }>(
          'SELECT t.* FROM oauth_tokens t JOIN consents c ON c.id=t.consent_id WHERE t.digest=$1 AND t.kind=$2 AND c.application_id=$3 FOR UPDATE OF t',
          [digest(String(body.refresh_token ?? '')), 'REFRESH', client.id],
          db,
        );
        if (!token) return { error: 'invalid_grant' } as const;
        if (token.used_at) {
          await query('UPDATE consents SET revoked_at=now() WHERE id=$1', [token.consent_id], db);
          return { error: 'invalid_grant' } as const;
        }
        if (token.revoked_at || new Date(token.expires_at).getTime() <= Date.now())
          return { error: 'invalid_grant' } as const;
        const grant = await this.activeGrant(token.consent_id, db);
        if (!grant) return { error: 'invalid_grant' } as const;
        const requested =
          typeof body.scope === 'string'
            ? [...new Set(body.scope.split(' ').filter(Boolean))]
            : token.scopes;
        if (!requested.length || requested.some((s) => !token.scopes.includes(s)))
          return { error: 'invalid_scope' } as const;
        await query(
          'UPDATE oauth_tokens SET used_at=now() WHERE digest=$1',
          [digest(String(body.refresh_token))],
          db,
        );
        return this.issue(db, grant, requested);
      });
      if ('error' in result)
        throw new OAuthError(
          result.error,
          'Refresh token unavailable or requested scopes exceed the grant.',
        );
      return result;
    }
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }
  async revoke(body: Record<string, unknown>, authorization?: string) {
    const client = await this.authenticateClient(body, authorization);
    await transaction(async (db) => {
      const [t] = await query<{ consent_id: string; kind: string }>(
        'SELECT t.consent_id,t.kind FROM oauth_tokens t JOIN consents c ON c.id=t.consent_id WHERE t.digest=$1 AND c.application_id=$2',
        [digest(String(body.token ?? '')), client.id],
        db,
      );
      if (t?.kind === 'REFRESH')
        await query('UPDATE consents SET revoked_at=now() WHERE id=$1', [t.consent_id], db);
      else if (t)
        await query(
          'UPDATE oauth_tokens SET revoked_at=now() WHERE digest=$1',
          [digest(String(body.token))],
          db,
        );
    });
    return {};
  }
  async credentials(value: string, requestId?: string) {
    const [token] = await query<{ consent_id: string; scopes: string[] }>(
      "SELECT consent_id,scopes FROM oauth_tokens WHERE digest=$1 AND kind='ACCESS' AND expires_at>now() AND revoked_at IS NULL",
      [digest(value)],
    );
    const grant = token ? await this.activeGrant(token.consent_id) : undefined;
    if (!grant || !token?.scopes.includes('credentials.read') || grant.slug)
      throw new OAuthError(
        'invalid_token',
        'The token must authorize selected holder credentials on the base identity.',
        401,
      );
    const result = await credentialsForGrant(grant.id);
    await applicationAccess(grant.id, 'credentials', requestId);
    await query('UPDATE consents SET last_access_at=now() WHERE id=$1', [grant.id]);
    return result;
  }
  async profile(value: string, requestId?: string) {
    const [token] = await query<{ consent_id: string; scopes: string[] }>(
      "SELECT consent_id,scopes FROM oauth_tokens WHERE digest=$1 AND kind='ACCESS' AND expires_at>now() AND revoked_at IS NULL",
      [digest(value)],
    );
    const grant = token ? await this.activeGrant(token.consent_id) : undefined;
    if (!grant || !token || !token.scopes.includes('identity.read'))
      throw new OAuthError(
        'invalid_token',
        'Access token expired, revoked or lacks identity.read.',
        401,
      );
    const nativeProfile = await this.applications.profileForGrant(
      { ...grant, scopes: token.scopes },
      requestId,
    );
    const profile = {
      ...nativeProfile,
      avatarUrl: token.scopes.includes('avatar.read') ? '/api/v1/oauth/avatar' : '',
    };
    if (token.scopes.includes('email.read') && grant.fields.includes('account:email')) {
      const [account] = await query<{ email: string }>(
        'SELECT email FROM accounts WHERE id=$1 AND verified_at IS NOT NULL AND state=$2',
        [grant.account_id, 'ACTIVE'],
      );
      return { ...profile, ...(account ? { email: account.email } : {}) };
    }
    return profile;
  }
}
