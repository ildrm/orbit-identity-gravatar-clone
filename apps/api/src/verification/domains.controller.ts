import { Input } from '../input.js';
import { Controller, Get, Post, Delete, Body, Param, Req, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { domainToASCII } from 'node:url';
import { resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { safeHttps } from '../../../../packages/core/src/outbound.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
const DomainsControllerbeginInput = z
  .object({
    domain: z.string().max(253),
    method: z.enum(['DNS', 'WELL_KNOWN']).default('DNS'),
  })
  .strict();
@ApiTags('Domain verification')
@Controller('api/v1/identities/:identity/domains')
export class DomainsController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get() async list(@Param('identity') identityId: string, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return query(
      'SELECT id,domain,method,verified_at,last_checked_at,expires_at,revoked_at,challenge_value,custom_enabled,canonical,routing_state FROM domains WHERE identity_id=$1 ORDER BY created_at',
      [identityId],
    );
  }
  @Input(DomainsControllerbeginInput)
  @Post()
  async begin(@Param('identity') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = DomainsControllerbeginInput.parse(b);
    const domain = domainToASCII(d.domain.trim().toLowerCase());
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || isIP(domain))
      throw new DomainError('INVALID_DOMAIN', 'Enter a registrable public hostname.');
    const domainId = id('dom'),
      value = 'identity-verification=' + secret();
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'security', db);
      await query(
        "INSERT INTO domains(id,identity_id,domain,method,challenge_digest,challenge_value,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')",
        [domainId, identityId, domain, d.method, digest(value), value],
        db,
      );
      await event(db, identityId, a.id, 'domain.created', r.requestId, { domainId });
    });
    return {
      id: domainId,
      domain,
      method: d.method,
      value,
      location:
        d.method === 'DNS'
          ? '_identity.' + domain
          : 'https://' + domain + '/.well-known/identity-verification',
    };
  }
  @Post(':id/verify') async verify(
    @Param('identity') identityId: string,
    @Param('id') domainId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await this.identities.authorize(a.id, identityId, 'security');
    const d = requireValue(
      (
        await query<{
          domain: string;
          method: string;
          challenge_digest: string;
          expires_at: Date;
          revoked_at: Date | null;
        }>('SELECT * FROM domains WHERE id=$1 AND identity_id=$2', [domainId, identityId])
      )[0],
    );
    if (d.revoked_at || new Date(d.expires_at).getTime() < Date.now())
      throw new DomainError('CHALLENGE_EXPIRED', 'Restart domain verification.');
    let values: string[];
    if (d.method === 'DNS') {
      try {
        values = (await resolveTxt('_identity.' + d.domain)).map((parts) => parts.join(''));
      } catch {
        throw new DomainError(
          'PROOF_NOT_FOUND',
          'DNS proof was not found. Allow time for propagation.',
        );
      }
    } else {
      const response = await safeHttps(
        'https://' + d.domain + '/.well-known/identity-verification',
        { maxBytes: 4096 },
      );
      values = response.status === 200 ? [response.body.trim()] : [];
    }
    if (!values.some((v) => digest(v) === d.challenge_digest))
      throw new DomainError('PROOF_NOT_FOUND', 'The ownership proof does not match.');
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'security', db);
      requireValue(
        (
          await query(
            'SELECT 1 FROM domains WHERE id=$1 AND identity_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',
            [domainId, identityId],
            db,
          )
        )[0],
        'Domain challenge changed',
      );
      await query(
        "UPDATE domains SET verified_at=now(),last_checked_at=now(),expires_at=now()+interval '30 days' WHERE id=$1",
        [domainId],
        db,
      );
      await event(db, identityId, a.id, 'domain.verified', r.requestId, { domainId });
    });
    return { message: 'Domain ownership verified for 30 days' };
  }
  @Delete(':id') async revoke(
    @Param('identity') identityId: string,
    @Param('id') domainId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'security', db);
      await query(
        'UPDATE domains SET revoked_at=now() WHERE id=$1 AND identity_id=$2',
        [domainId, identityId],
        db,
      );
      await event(db, identityId, a.id, 'domain.revoked', r.requestId, { domainId });
    });
    return { message: 'Domain revoked' };
  }
}
