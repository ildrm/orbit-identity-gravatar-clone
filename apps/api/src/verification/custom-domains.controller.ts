import { Input } from '../input.js';
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { lookup } from 'node:dns/promises';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Response } from 'express';
import { config } from '../../../../packages/core/src/config.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { event } from '../../../../packages/core/src/events.js';
import {
  checkDomainProof,
  checkDomainRouting,
  type DomainProof,
} from '../../../../packages/core/src/domain-proof.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
function internal(r: ApiRequest) {
  const key = r.headers['x-internal-api-key'],
    expected = config().INTERNAL_API_KEY;
  if (
    typeof key !== 'string' ||
    key.length !== expected.length ||
    !timingSafeEqual(Buffer.from(key), Buffer.from(expected))
  )
    throw new DomainError('NOT_FOUND', 'Unavailable.', 404);
}
const CustomDomainsControllerroutingInput = z
  .object({ enabled: z.boolean(), canonical: z.boolean().default(false) })
  .strict();
@ApiTags('Custom domains')
@Controller()
export class CustomDomainsController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Input(CustomDomainsControllerroutingInput)
  @Post('api/v1/identities/:id/domains/:domain/routing')
  async routing(
    @Param('id') identityId: string,
    @Param('domain') domainId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const d = CustomDomainsControllerroutingInput.parse(b),
      accountId = requireAccount(r).id;
    await this.identities.authorize(accountId, identityId, 'security');
    const domain = requireValue(
      (
        await query<DomainProof>(
          'SELECT * FROM domains WHERE id=$1 AND identity_id=$2 AND verified_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now()',
          [domainId, identityId],
        )
      )[0],
      'Verify this domain first',
    );
    if (d.enabled) {
      if (!config().CUSTOM_DOMAIN_TARGET)
        throw new DomainError(
          'CUSTOM_DOMAINS_UNAVAILABLE',
          'The operator must configure the public custom-domain ingress target.',
          503,
        );
      if (
        domain.method !== 'DNS' ||
        !(await checkDomainProof(domain)) ||
        !(await checkDomainRouting(domain.domain))
      )
        throw new DomainError(
          'DOMAIN_ROUTING_FAILED',
          'Keep the TXT ownership proof and point a CNAME at ' +
            config().CUSTOM_DOMAIN_TARGET +
            '.',
        );
    }
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      const current = requireValue(
        (
          await query<DomainProof>(
            'SELECT * FROM domains WHERE id=$1 AND identity_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',
            [domainId, identityId],
            db,
          )
        )[0],
        'Domain unavailable',
      );
      if (current.challenge_digest !== domain.challenge_digest)
        throw new DomainError(
          'DOMAIN_CHANGED',
          'Restart verification after this domain changed.',
          409,
        );
      if (d.canonical)
        await query('UPDATE domains SET canonical=false WHERE identity_id=$1', [identityId], db);
      await query(
        'UPDATE domains SET custom_enabled=$2,canonical=$3,routing_state=$4,last_checked_at=now() WHERE id=$1',
        [domainId, d.enabled, d.enabled && d.canonical, d.enabled ? 'ACTIVE' : 'DISABLED'],
        db,
      );
      await event(db, identityId, accountId, 'domain.updated', r.requestId, {
        domainId,
        routing: d.enabled,
      });
    });
    return {
      message: d.enabled
        ? 'Custom domain enabled. TLS is issued on its first valid HTTPS request.'
        : 'Custom domain routing disabled.',
      url: 'https://' + domain.domain,
    };
  }
  private async active(domain: string) {
    return (
      await query<{ id: string; handle: string; domain: string; canonical: boolean }>(
        "SELECT i.id,i.handle,d.domain,d.canonical FROM domains d JOIN identities i ON i.id=d.identity_id WHERE d.domain=$1 AND d.custom_enabled AND d.routing_state='ACTIVE' AND d.revoked_at IS NULL AND d.verified_at IS NOT NULL AND d.expires_at>now() AND d.last_checked_at>now()-interval '26 hours' AND i.state='ACTIVE' AND i.visibility IN ('PUBLIC','UNLISTED')",
        [domain.toLowerCase()],
      )
    )[0];
  }
  @Get('internal/custom-domains/authorize') async tls(
    @Query('domain') domain: string,
    @Req() r: ApiRequest,
    @Res() res: Response,
  ) {
    if (r.headers['x-internal-api-key']) internal(r);
    else {
      const addresses = await lookup('tls-edge', { all: true }).catch(() => []);
      const remote = r.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (!remote || !addresses.some((a) => a.address === remote))
        throw new DomainError('NOT_FOUND', 'Unavailable.', 404);
    }
    const row = await this.active(z.string().max(253).parse(domain));
    return row ? res.status(204).end() : res.status(403).end();
  }
  @Get('internal/custom-domains/route') async route(
    @Query('domain') domain: string,
    @Req() r: ApiRequest,
  ) {
    internal(r);
    return requireValue(await this.active(z.string().max(253).parse(domain)), 'Domain unavailable');
  }
  @Post('api/v1/identities/:id/domains/:domain/restart') async restart(
    @Param('id') identityId: string,
    @Param('domain') domainId: string,
    @Req() r: ApiRequest,
  ) {
    const { secret, digest } = await import('../../../../packages/core/src/security.js'),
      value = 'identity-verification=' + secret(),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      requireValue(
        (
          await query(
            "UPDATE domains SET challenge_value=$1,challenge_digest=$2,verified_at=NULL,last_checked_at=NULL,expires_at=now()+interval '24 hours',revoked_at=NULL,custom_enabled=false,canonical=false,routing_state='DISABLED' WHERE id=$3 AND identity_id=$4 RETURNING id",
            [value, digest(value), domainId, identityId],
            db,
          )
        )[0],
        'Domain unavailable',
      );
      await event(db, identityId, accountId, 'domain.restarted', r.requestId, { domainId });
    });
    return {
      value,
      message: 'Publish the new proof and verify again. Previous proof and routing are invalid.',
    };
  }
}
