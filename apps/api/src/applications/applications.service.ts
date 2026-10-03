import { applicationAccess } from '../../../../packages/core/src/application-access.js';
import { credentialsForGrant } from '../../../../packages/core/src/consented-credentials.js';
import { recordAggregate } from '../../../../packages/core/src/analytics.js';
import { Injectable, Inject } from '@nestjs/common';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest, encrypt } from '../../../../packages/core/src/security.js';
import { audit, event } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import {
  applicationSchema,
  consentSchema,
  webhookSchema,
} from '../../../../packages/contracts/src/index.js';
import { IdentityService } from '../identity/identity.service.js';
import { safeHttps } from '../../../../packages/core/src/outbound.js';
@Injectable()
export class ApplicationsService {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  list(accountId: string) {
    return query(
      'SELECT id,name,purpose,redirect_uris,oauth_mode,created_at,revoked_at FROM applications WHERE account_id=$1 ORDER BY created_at',
      [accountId],
    );
  }
  async clientInfo(token: string) {
    const application = requireValue(
      (
        await query<{ id: string; name: string; purpose: string }>(
          'SELECT id,name,purpose FROM applications WHERE key_digest=$1 AND revoked_at IS NULL',
          [digest(token)],
        )
      )[0],
      'Application credential unavailable',
    );
    return application;
  }
  async create(accountId: string, input: unknown, requestId: string) {
    const d = applicationSchema.parse(input),
      applicationId = id('app'),
      key = 'ik_' + secret();
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT 1 FROM accounts WHERE id=$1 AND state='ACTIVE' FOR UPDATE",
            [accountId],
            db,
          )
        )[0],
      );
      if (
        (
          await query(
            'SELECT 1 FROM applications WHERE account_id=$1 AND revoked_at IS NULL OFFSET 99 LIMIT 1',
            [accountId],
            db,
          )
        ).length
      )
        throw new DomainError(
          'APPLICATION_LIMIT',
          'Revoke unused applications before registering another.',
        );
      await query(
        'INSERT INTO applications(id,account_id,name,purpose,redirect_uris,key_digest) VALUES($1,$2,$3,$4,$5,$6)',
        [applicationId, accountId, d.name, d.purpose, JSON.stringify(d.redirectUris), digest(key)],
        db,
      );
      await audit(db, accountId, null, 'application.created', requestId, { applicationId });
    });
    return { id: applicationId, ...d, apiKey: key };
  }
  async revoke(accountId: string, applicationId: string, requestId: string) {
    await transaction(async (db) => {
      const rows = await query(
        'UPDATE applications SET revoked_at=now(),key_digest=NULL WHERE id=$1 AND account_id=$2 RETURNING id',
        [applicationId, accountId],
        db,
      );
      if (!rows.length) throw new DomainError('FORBIDDEN', 'Application unavailable', 403);
      await query(
        'UPDATE consents SET revoked_at=now() WHERE application_id=$1',
        [applicationId],
        db,
      );
      await query('UPDATE webhooks SET enabled=false WHERE application_id=$1', [applicationId], db);
      await audit(db, accountId, null, 'application.revoked', requestId, { applicationId });
    });
    return { message: 'Application revoked' };
  }
  async rotate(accountId: string, applicationId: string, requestId: string) {
    const key = 'ik_' + secret();
    await transaction(async (db) => {
      const rows = await query(
        'UPDATE applications SET key_digest=$1 WHERE id=$2 AND account_id=$3 AND revoked_at IS NULL RETURNING id',
        [digest(key), applicationId, accountId],
        db,
      );
      if (!rows.length) throw new DomainError('FORBIDDEN', 'Application unavailable', 403);
      await audit(db, accountId, null, 'application.key_rotated', requestId, { applicationId });
    });
    return { apiKey: key };
  }
  async grant(accountId: string, identityId: string, input: unknown, requestId: string) {
    const d = consentSchema.parse(input),
      token = 'ic_' + secret(),
      consentId = id('cns');
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      requireValue(
        (
          await query(
            'SELECT 1 FROM applications WHERE id=$1 AND revoked_at IS NULL',
            [d.applicationId],
            db,
          )
        )[0],
        'Application unavailable',
      );
      if (d.personaId)
        requireValue(
          (
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
              [d.personaId, identityId],
              db,
            )
          )[0],
          'Persona unavailable',
        );
      const expiry = d.expiresAt ? new Date(d.expiresAt) : new Date(Date.now() + 30 * 86400000);
      if (expiry.getTime() <= Date.now() || expiry.getTime() > Date.now() + 365 * 86400000)
        throw new DomainError('INVALID_EXPIRY', 'Consent must expire within one year.');
      await query(
        'INSERT INTO consents(id,identity_id,application_id,persona_id,scopes,fields,token_digest,expires_at,account_id,purpose) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT purpose FROM applications WHERE id=$3))',
        [
          consentId,
          identityId,
          d.applicationId,
          d.personaId,
          JSON.stringify(d.scopes),
          JSON.stringify(d.fields),
          digest(token),
          expiry,
          accountId,
        ],
        db,
      );
      await event(db, identityId, accountId, 'consent.updated', requestId, { consentId });
    });
    return { id: consentId, token, ...d };
  }
  async consents(accountId: string, identityId: string) {
    await this.identities.authorize(accountId, identityId, 'security');
    return query(
      'SELECT c.id,c.application_id,a.name,a.purpose,c.persona_id,c.scopes,c.fields,c.granted_at,c.expires_at,c.last_access_at,c.revoked_at,c.protocol FROM consents c JOIN applications a ON a.id=c.application_id WHERE c.identity_id=$1 ORDER BY c.granted_at DESC',
      [identityId],
    );
  }
  async revokeConsent(accountId: string, identityId: string, consentId: string, requestId: string) {
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      await query(
        'UPDATE consents SET revoked_at=now() WHERE id=$1 AND identity_id=$2',
        [consentId, identityId],
        db,
      );
      await event(db, identityId, accountId, 'consent.updated', requestId, {
        consentId,
        revoked: true,
      });
    });
    return { message: 'Access revoked' };
  }
  async consentedProfile(token: string, requestId?: string) {
    const [c] = await query<{
      id: string;
      identity_id: string;
      application_id: string;
      slug: string | null;
      scopes: string[];
      fields: string[];
    }>(
      "SELECT c.*,p.slug FROM consents c JOIN applications a ON a.id=c.application_id LEFT JOIN personas p ON p.id=c.persona_id WHERE c.token_digest=$1 AND c.revoked_at IS NULL AND c.expires_at>now() AND a.revoked_at IS NULL AND EXISTS(SELECT 1 FROM memberships m JOIN accounts ac ON ac.id=m.account_id WHERE m.identity_id=c.identity_id AND m.account_id=c.account_id AND m.role='OWNER' AND ac.state='ACTIVE') AND (c.persona_id IS NULL OR p.active)",
      [digest(token)],
    );
    if (!c || !c.scopes.includes('identity.read'))
      throw new DomainError(
        'INVALID_TOKEN',
        'This access token is expired, revoked or lacks identity.read.',
        401,
      );
    return this.profileForGrant(c, requestId);
  }
  async consentedCredentials(token: string, requestId?: string) {
    const [c] = await query<{ id: string }>(
      "SELECT c.id FROM consents c JOIN identities i ON i.id=c.identity_id AND i.state='ACTIVE' JOIN applications a ON a.id=c.application_id AND a.revoked_at IS NULL WHERE c.token_digest=$1 AND c.revoked_at IS NULL AND c.expires_at>now() AND c.persona_id IS NULL AND c.scopes @> '[\"credentials.read\"]'::jsonb AND EXISTS(SELECT 1 FROM memberships m JOIN accounts owner ON owner.id=m.account_id AND owner.state='ACTIVE' WHERE m.identity_id=c.identity_id AND m.account_id=c.account_id AND m.role='OWNER')",
      [digest(token)],
    );
    if (!c)
      throw new DomainError('INVALID_TOKEN', 'Selected credentials.read consent required.', 401);
    const result = await credentialsForGrant(c.id);
    await applicationAccess(c.id, 'credentials', requestId);
    await query('UPDATE consents SET last_access_at=now() WHERE id=$1', [c.id]);
    return result;
  }
  async profileForGrant(
    c: {
      id: string;
      identity_id: string;
      application_id: string;
      slug: string | null;
      scopes: string[];
      fields: string[];
    },
    requestId?: string,
  ) {
    const p = await this.identities.profile(c.identity_id, c.slug, 'api', {
      applicationId: c.application_id,
      authenticated: true,
      consentedFields: c.fields,
      scopes: c.scopes,
    });
    await applicationAccess(c.id, 'profile', requestId);
    await recordAggregate(c.identity_id, 'application_request');
    await query('UPDATE consents SET last_access_at=now() WHERE id=$1', [c.id]);
    return {
      ...p,
      avatarUrl: c.scopes.includes('avatar.read') ? '/api/v1/application/avatar' : '',
    };
  }
  async addWebhook(accountId: string, applicationId: string, input: unknown, requestId: string) {
    const d = webhookSchema.parse(input);
    requireValue(
      (
        await query(
          'SELECT 1 FROM applications WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL',
          [applicationId, accountId],
        )
      )[0],
      'Application unavailable',
    );
    const check = await safeHttps(d.url, { method: 'HEAD', maxBytes: 1024 });
    if (check.status >= 500)
      throw new DomainError('WEBHOOK_UNREACHABLE', 'Webhook destination is unavailable.');
    const key = secret(),
      webhookId = id('whk');
    await transaction(async (db) => {
      await query(
        'INSERT INTO webhooks(id,application_id,url,events,secret_encrypted) VALUES($1,$2,$3,$4,$5)',
        [webhookId, applicationId, d.url, JSON.stringify(d.events), encrypt(key)],
        db,
      );
      await audit(db, accountId, null, 'webhook.created', requestId, { applicationId, webhookId });
    });
    return { id: webhookId, secret: key, ...d };
  }
  async webhooks(accountId: string, applicationId: string) {
    requireValue(
      (
        await query('SELECT 1 FROM applications WHERE id=$1 AND account_id=$2', [
          applicationId,
          accountId,
        ])
      )[0],
    );
    return query(
      'SELECT id,url,events,enabled,failures,created_at FROM webhooks WHERE application_id=$1',
      [applicationId],
    );
  }
}
