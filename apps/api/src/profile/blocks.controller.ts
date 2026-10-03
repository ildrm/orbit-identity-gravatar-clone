import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { event, enqueue } from '../../../../packages/core/src/events.js';
import { id } from '../../../../packages/core/src/security.js';
import { blockSchema } from '../../../../packages/core/src/blocks.js';
import { requireValue, DomainError } from '../../../../packages/core/src/errors.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const BlocksControllerreorderInput = z
  .object({ ids: z.array(z.string().regex(/^blk_[a-f0-9]{32}$/)).max(100) })
  .strict();
const BlocksControllersettingsInput = z.object({ enabled: z.boolean() }).strict();
@ApiTags('Profile composition and analytics')
@Controller('api/v1/identities')
export class BlocksController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get(':id/blocks') async list(@Param('id') identityId: string, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    return query(
      'SELECT * FROM profile_blocks WHERE identity_id=$1 ORDER BY position,id LIMIT 100',
      [identityId],
    );
  }
  @Input(blockSchema)
  @Post(':id/blocks')
  create(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    return this.save(identityId, id('blk'), b, r, true);
  }
  @Input(BlocksControllerreorderInput)
  @Post(':id/block-order')
  async reorder(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { ids } = BlocksControllerreorderInput.parse(b),
      accountId = requireAccount(r).id;
    if (new Set(ids).size !== ids.length)
      throw new DomainError('INVALID_ORDER', 'Each block must appear once.');
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'profile', db);
      const blocks = await query<{ id: string }>(
        'SELECT id FROM profile_blocks WHERE identity_id=$1 FOR UPDATE',
        [identityId],
        db,
      );
      if (blocks.length !== ids.length || blocks.some((b) => !ids.includes(b.id)))
        throw new DomainError('STALE_ORDER', 'Reload blocks and try again.', 409);
      await this.identities.snapshot(db, identityId, accountId);
      await query(
        'UPDATE profile_blocks b SET position=o.position-1,updated_at=now() FROM unnest($2::text[]) WITH ORDINALITY AS o(id,position) WHERE b.identity_id=$1 AND b.id=o.id',
        [identityId, ids],
        db,
      );
      await event(db, identityId, accountId, 'profile.updated', r.requestId, { reordered: true });
    });
    return { message: 'Block order saved.' };
  }
  @Input(blockSchema)
  @Put(':id/blocks/:block')
  update(
    @Param('id') identityId: string,
    @Param('block') blockId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    return this.save(identityId, blockId, b, r, false);
  }
  private async save(
    identityId: string,
    blockId: string,
    b: unknown,
    r: ApiRequest,
    create: boolean,
  ) {
    const d = blockSchema.parse(b),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'profile', db);
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
      for (const mediaId of d.configuration.mediaIds)
        requireValue(
          (
            await query(
              "SELECT 1 FROM media WHERE id=$1 AND identity_id=$2 AND status='READY'",
              [mediaId, identityId],
              db,
            )
          )[0],
          'Media must be validated and owned by this identity',
        );
      if (create) {
        const [countRow] = await query<{ count: string }>(
          'SELECT count(*) FROM profile_blocks WHERE identity_id=$1',
          [identityId],
          db,
        );
        if (Number(countRow!.count) >= 100)
          throw new DomainError('LIMIT_REACHED', 'An identity supports up to 100 profile blocks.');
      } else
        requireValue(
          (
            await query(
              'SELECT 1 FROM profile_blocks WHERE id=$1 AND identity_id=$2',
              [blockId, identityId],
              db,
            )
          )[0],
          'Block unavailable',
        );
      await this.identities.snapshot(db, identityId, accountId);
      await query(
        'INSERT INTO profile_blocks(id,identity_id,persona_id,kind,position,enabled,locale,title,configuration,policy,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET persona_id=EXCLUDED.persona_id,kind=EXCLUDED.kind,position=EXCLUDED.position,enabled=EXCLUDED.enabled,locale=EXCLUDED.locale,title=EXCLUDED.title,configuration=EXCLUDED.configuration,policy=EXCLUDED.policy,actor_id=EXCLUDED.actor_id,updated_at=now()',
        [
          blockId,
          identityId,
          d.personaId,
          d.kind,
          d.position,
          d.enabled,
          d.locale,
          d.title,
          JSON.stringify(d.configuration),
          JSON.stringify(d.policy),
          accountId,
        ],
        db,
      );
      if (d.kind === 'feed' && d.configuration.url)
        await enqueue(db, 'feed-refresh', { blockId, requestId: r.requestId });
      await event(db, identityId, accountId, 'profile.updated', r.requestId, { blockId });
    });
    return { id: blockId };
  }
  @Delete(':id/blocks/:block') async remove(
    @Param('id') identityId: string,
    @Param('block') blockId: string,
    @Req() r: ApiRequest,
  ) {
    const accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'profile', db);
      await this.identities.snapshot(db, identityId, accountId);
      await query(
        'DELETE FROM profile_blocks WHERE id=$1 AND identity_id=$2',
        [blockId, identityId],
        db,
      );
      await event(db, identityId, accountId, 'profile.updated', r.requestId, {
        blockId,
        removed: true,
      });
    });
    return { message: 'Block removed.' };
  }
  @Input(BlocksControllersettingsInput)
  @Put(':id/analytics/settings')
  async settings(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { enabled } = BlocksControllersettingsInput.parse(b),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      await query(
        'UPDATE identities SET analytics_enabled=$2 WHERE id=$1',
        [identityId, enabled],
        db,
      );
      if (!enabled)
        await query('DELETE FROM analytics_daily WHERE identity_id=$1', [identityId], db);
      await event(db, identityId, accountId, 'analytics.updated', r.requestId, { enabled });
    });
    return { enabled };
  }
  @Get(':id/analytics') async analytics(@Param('id') identityId: string, @Req() r: ApiRequest) {
    const identity = await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    return {
      enabled: !!identity.analytics_enabled,
      retentionDays: 90,
      days: await query(
        'SELECT day,kind,count FROM analytics_daily WHERE identity_id=$1 AND day>=current_date-90 ORDER BY day DESC,kind',
        [identityId],
      ),
    };
  }
}
