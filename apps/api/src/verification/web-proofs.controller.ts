import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { enqueue, event } from '../../../../packages/core/src/events.js';
import { safeUrlSchema } from '../../../../packages/contracts/src/index.js';
import { requireValue, DomainError } from '../../../../packages/core/src/errors.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const WebProofsControllercreateInput = z.object({ url: safeUrlSchema }).strict();
@ApiTags('Reciprocal web ownership')
@Controller('api/v1/identities/:id/web-proofs')
export class WebProofsController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get() async list(@Param('id') identityId: string, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return query(
      'SELECT * FROM web_proofs WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100',
      [identityId],
    );
  }
  @Input(WebProofsControllercreateInput)
  @Post()
  async create(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { url } = WebProofsControllercreateInput.parse(b),
      accountId = requireAccount(r).id,
      proofId = id('web');
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      const [count] = await query<{ count: string }>(
        'SELECT count(*) FROM web_proofs WHERE identity_id=$1',
        [identityId],
        db,
      );
      if (Number(count!.count) >= 100)
        throw new DomainError('LIMIT_REACHED', 'Maximum web proofs reached.');
      const [row] = await query<{ id: string }>(
        "INSERT INTO web_proofs(id,identity_id,url) VALUES($1,$2,$3) ON CONFLICT(identity_id,url) DO UPDATE SET status='PENDING',revoked_at=NULL RETURNING id",
        [proofId, identityId, url],
        db,
      );
      await enqueue(db, 'web-proof', { proofId: row!.id, requestId: r.requestId });
      await event(db, identityId, accountId, 'web.requested', r.requestId, { proofId: row!.id });
    });
    return {
      message:
        'Reciprocal verification queued. Publish a profile link to this exact HTTPS address, and add rel=me on that page linking back to your current public profile URL.',
    };
  }
  @Delete(':proof') async revoke(
    @Param('id') identityId: string,
    @Param('proof') proofId: string,
    @Req() r: ApiRequest,
  ) {
    await transaction(async (db) => {
      const accountId = requireAccount(r).id;
      await this.identities.authorize(accountId, identityId, 'security', db);
      requireValue(
        (
          await query(
            "UPDATE web_proofs SET revoked_at=now(),status='REVOKED' WHERE id=$1 AND identity_id=$2 RETURNING id",
            [proofId, identityId],
            db,
          )
        )[0],
        'Web proof unavailable',
      );
      await event(db, identityId, accountId, 'web.revoked', r.requestId, { proofId });
    });
    return { message: 'Web ownership proof revoked.' };
  }
}
