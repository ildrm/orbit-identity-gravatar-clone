import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query } from '../../../../packages/core/src/db.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { resolveDid, nativeDid } from '../../../../packages/core/src/did.js';
import { rateLimit } from '../../../../packages/core/src/redis.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
interface ResolverAdapter {
  resolve(
    value: string,
    r: ApiRequest,
  ): Promise<{ identityId: string; provenance: string; owner?: boolean }>;
}
@ApiTags('Policy-aware identifier resolution')
@Controller('api/v1')
export class ResolverController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get('resolve') async resolve(
    @Query('type') type: string,
    @Query('identifier') identifier: string,
    @Req() r: ApiRequest,
  ) {
    const input = z
      .object({
        type: z.enum(['native', 'domain', 'email', 'github', 'did']),
        identifier: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse({ type, identifier });
    const limit = await rateLimit('resolver:' + (r.account?.id ?? r.ip ?? 'unknown'), 30, 60);
    if (!limit.allowed)
      throw new DomainError(
        'RESOLVER_LIMIT',
        'Wait before more identifier resolution requests.',
        429,
      );
    const adapters: Record<string, ResolverAdapter> = {
      native: {
        resolve: async (value) => ({ identityId: value.replace(/^@/, ''), provenance: 'native' }),
      },
      email: {
        resolve: async (value, req) => {
          const a = requireAccount(req);
          if (a.email !== value.toLowerCase())
            throw new DomainError('NOT_FOUND', 'Verified account identifier unavailable.', 404);
          const row = requireValue(
            (
              await query<{ id: string }>(
                "SELECT i.id FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE m.account_id=$1 AND m.role='OWNER' AND i.type='PERSON' AND i.state='ACTIVE' ORDER BY i.created_at LIMIT 1",
                [a.id],
              )
            )[0],
            'Owned personal identity unavailable',
          );
          return { identityId: row.id, provenance: 'verified-account-email', owner: true };
        },
      },
      domain: {
        resolve: async (value) => {
          const domain = z
            .string()
            .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
            .parse(value.toLowerCase());
          const row = requireValue(
            (
              await query<{ identity_id: string }>(
                "SELECT d.identity_id FROM domains d JOIN identities i ON i.id=d.identity_id WHERE d.domain=$1 AND d.verified_at IS NOT NULL AND d.revoked_at IS NULL AND d.expires_at>now() AND i.state='ACTIVE' AND i.visibility='PUBLIC' AND (d.custom_enabled OR EXISTS(SELECT 1 FROM claims c WHERE c.identity_id=i.id AND c.key='core:website' AND c.selected AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>now()) AND c.policy->>'visibility'='PUBLIC' AND c.policy->>'api'='true' AND c.policy->>'transformation'='FULL' AND split_part(split_part(c.value#>>'{}','://',2),'/',1)=$1))",
                [domain],
              )
            )[0],
            'Public verified domain unavailable',
          );
          return { identityId: row.identity_id, provenance: 'verified-domain' };
        },
      },
      github: {
        resolve: async (value) => {
          const providerId = z
            .string()
            .regex(/^[1-9][0-9]{0,19}$/)
            .parse(value);
          const row = requireValue(
            (
              await query<{ identity_id: string }>(
                "SELECT p.identity_id FROM provider_connections p JOIN identities i ON i.id=p.identity_id WHERE p.provider='github' AND p.provider_id=$1 AND p.revoked_at IS NULL AND i.visibility='PUBLIC' AND i.state='ACTIVE' AND EXISTS(SELECT 1 FROM claims c WHERE c.identity_id=i.id AND c.key='developer:github' AND c.source_reference='github:'||p.provider_id AND (c.expires_at IS NULL OR c.expires_at>now()) AND c.selected AND c.revoked_at IS NULL AND c.policy->>'visibility'='PUBLIC' AND c.policy->>'api'='true' AND c.policy->>'transformation'='FULL')",
                [providerId],
              )
            )[0],
            'Published provider connection unavailable',
          );
          return { identityId: row.identity_id, provenance: 'github-immutable-account-id' };
        },
      },
      did: {
        resolve: async (value) => {
          const prefix = nativeDid() + ':api:v1:dids:';
          if (value.startsWith(prefix) && /^idn_[a-f0-9]{32}$/.test(value.slice(prefix.length))) {
            await resolveDid(value);
            return { identityId: value.slice(prefix.length), provenance: 'native-did' };
          }
          const association = requireValue(
            (
              await query<{ identity_id: string; key_id: string }>(
                'SELECT identity_id,key_id FROM did_associations WHERE did=$1 AND revoked_at IS NULL AND expires_at>now()',
                [value],
              )
            )[0],
            'Current DID association unavailable',
          );
          const document = await resolveDid(value);
          if (!document.authentication?.includes(association.key_id))
            throw new DomainError('NOT_FOUND', 'Associated DID key was revoked.', 404);
          return { identityId: association.identity_id, provenance: 'signed-did-association' };
        },
      },
    };
    const resolved = await adapters[input.type]!.resolve(input.identifier, r);
    const profile = await this.identities.profile(
      resolved.identityId,
      null,
      'api',
      resolved.owner
        ? { owner: true, accountId: requireAccount(r).id }
        : { accountId: r.account?.id, authenticated: Boolean(r.account) },
    );
    return {
      profile,
      resolution: {
        adapter: input.type,
        provenance: resolved.provenance,
        fallback: 'native deterministic avatar',
        cache: 'no-store',
        externalFetch: input.type === 'did',
      },
    };
  }
}
