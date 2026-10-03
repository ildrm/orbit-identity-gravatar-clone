import { Controller, Get, Param, Query, Res, Req, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { IdentityService } from '../identity/identity.service.js';
import { config } from '../../../../packages/core/src/config.js';
import { DomainError } from '../../../../packages/core/src/errors.js';
import { handleSchema } from '../../../../packages/contracts/src/index.js';
import type { ApiRequest } from '../http.js';
function vEscape(s: string) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
@ApiTags('Public profiles')
@Controller()
export class ProfileController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get('api/v1/profiles/:identifier') async profile(
    @Param('identifier') identifier: string,
    @Query('persona') persona: string | undefined,
    @Query('channel') channel: string | undefined,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const c = z.enum(['api', 'machine', 'agent', 'index']).default('api').parse(channel);
    res.setHeader('Cache-Control', 'no-store');
    return this.identities.profile(
      identifier,
      persona ?? null,
      c,
      req.account ? { accountId: req.account.id } : {},
    );
  }
  @Get('api/v1/search') async search(
    @Query('q') term: string,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const q = z.string().trim().min(2).max(80).parse(term),
      n = z.coerce.number().int().min(1).max(50).default(20).parse(limit);
    res.setHeader('Cache-Control', 'no-store');
    const items = await this.identities.search(q, n, cursor ?? '');
    return { items, nextCursor: items.length === n ? items.at(-1)?.id : null };
  }
  @Get('api/v1/profiles/:identifier/vcard') async vcard(
    @Param('identifier') identifier: string,
    @Query('persona') persona: string | undefined,
    @Res() res: Response,
  ) {
    const p = await this.identities.profile(identifier, persona ?? null, 'machine');
    const fields = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:' + vEscape(p.displayName),
      'UID:' + p.id,
      'URL:' + config().PUBLIC_ORIGIN + '/u/' + p.handle,
    ];
    const bio = p.claims.find((c) => c.key === 'core:bio')?.value;
    if (typeof bio === 'string') fields.push('NOTE:' + vEscape(bio));
    const website = p.claims.find((c) => c.key === 'core:website')?.value;
    if (typeof website === 'string') fields.push('URL:' + vEscape(website));
    fields.push('END:VCARD');
    res.setHeader('Cache-Control', 'no-store');
    res
      .type('text/vcard')
      .attachment(p.handle + '.vcf')
      .send(fields.join('\r\n') + '\r\n');
  }
  @Get('.well-known/webfinger') async webfinger(
    @Query('resource') resource: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const domain = new URL(config().PUBLIC_ORIGIN).hostname;
    const match = z
      .string()
      .max(300)
      .parse(resource)
      .match(/^acct:([a-z0-9_]+)@([^/]+)$/);
    if (!match || match[2] !== domain)
      throw new DomainError('NOT_FOUND', 'Resource unavailable', 404);
    const p = await this.identities.profile(handleSchema.parse(match[1]), null, 'machine');
    res.type('application/jrd+json');
    res.setHeader('Cache-Control', 'no-store');
    return {
      subject: 'acct:' + p.handle + '@' + domain,
      aliases: [config().PUBLIC_ORIGIN + '/u/' + p.handle],
      links: [
        {
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: config().PUBLIC_ORIGIN + '/u/' + p.handle,
        },
      ],
    };
  }
}
