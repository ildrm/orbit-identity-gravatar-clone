import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query } from '../../../../packages/core/src/db.js';
import { requireValue } from '../../../../packages/core/src/errors.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
@ApiTags('Profile preview')
@Controller('api/v1/identities')
export class PreviewController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get(':id/preview-grants') async grants(@Param('id') identityId: string, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    return query(
      "SELECT c.id,a.name,p.slug FROM consents c JOIN applications a ON a.id=c.application_id LEFT JOIN personas p ON p.id=c.persona_id WHERE c.identity_id=$1 AND c.revoked_at IS NULL AND c.expires_at>now() AND a.revoked_at IS NULL AND c.scopes @> '[\"identity.read\"]'::jsonb AND (c.persona_id IS NULL OR p.active) AND EXISTS(SELECT 1 FROM memberships m JOIN accounts holder ON holder.id=m.account_id AND holder.state='ACTIVE' WHERE m.account_id=c.account_id AND m.identity_id=c.identity_id AND m.role='OWNER') ORDER BY a.name,c.id LIMIT 100",
      [identityId],
    );
  }
  @Get(':id/preview') async preview(
    @Param('id') identityId: string,
    @Query() raw: unknown,
    @Req() r: ApiRequest,
  ) {
    const d = z
      .object({
        audience: z.enum(['PUBLIC', 'SEARCH', 'APPLICATION', 'OWNER']).default('PUBLIC'),
        persona: z.string().max(30).optional(),
        consent: z.string().max(100).optional(),
      })
      .strict()
      .parse(raw);
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    if (d.audience !== 'APPLICATION')
      return this.identities.profile(
        identityId,
        d.persona ?? null,
        d.audience === 'SEARCH' ? 'index' : 'human',
        d.audience === 'OWNER' ? { owner: true } : {},
      );
    const grant = requireValue(
      (
        await query<{
          application_id: string;
          slug: string | null;
          fields: string[];
          scopes: string[];
        }>(
          "SELECT c.application_id,c.fields,c.scopes,p.slug FROM consents c JOIN applications a ON a.id=c.application_id LEFT JOIN personas p ON p.id=c.persona_id WHERE c.id=$1 AND c.identity_id=$2 AND c.revoked_at IS NULL AND c.expires_at>now() AND a.revoked_at IS NULL AND c.scopes @> '[\"identity.read\"]'::jsonb AND (c.persona_id IS NULL OR p.active) AND EXISTS(SELECT 1 FROM memberships m JOIN accounts holder ON holder.id=m.account_id AND holder.state='ACTIVE' WHERE m.account_id=c.account_id AND m.identity_id=c.identity_id AND m.role='OWNER')",
          [d.consent ?? '', identityId],
        )
      )[0],
      'Choose a current application grant.',
    );
    return this.identities.profile(identityId, grant.slug, 'api', {
      applicationId: grant.application_id,
      authenticated: true,
      consentedFields: grant.fields,
      scopes: grant.scopes,
    });
  }
}
