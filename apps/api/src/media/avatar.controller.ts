import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { imageTransforms } from '../../../../packages/core/src/media-edit.js';
import { getObject, putObject, deleteObject } from '../../../../packages/core/src/storage.js';
import { rateLimit } from '../../../../packages/core/src/redis.js';
import { id } from '../../../../packages/core/src/security.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { enqueue, event } from '../../../../packages/core/src/events.js';
const AvatarControllereditInput = z
  .object({ transforms: imageTransforms, alt: z.string().trim().min(1).max(200) })
  .strict();
const AvatarControllerselectInput = z
  .object({
    mediaId: z.string().regex(/^med_[a-f0-9]{32}$/),
    personaId: z.string().nullable().default(null),
    context: z.enum(['DEFAULT', 'APPLICATION', 'DOMAIN']).default('DEFAULT'),
    applicationId: z.string().nullable().default(null),
    domainId: z.string().nullable().default(null),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
@ApiTags('Media and avatars')
@Controller('api/v1/identities/:identity')
export class AvatarController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Input(AvatarControllereditInput)
  @Post('media/:media/edit')
  async edit(
    @Param('identity') identity: string,
    @Param('media') source: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r),
      d = AvatarControllereditInput.parse(b);
    await this.identities.authorize(a.id, identity, 'profile');
    if (!(await rateLimit('media:' + a.id, 20, 3600)).allowed)
      throw new DomainError('UPLOAD_LIMIT', 'Hourly image processing limit reached.', 429);
    const m = requireValue(
      (
        await query<{ source_key: string; purpose: string; persona_id: string | null }>(
          "SELECT source_key,purpose,persona_id FROM media WHERE id=$1 AND identity_id=$2 AND status='READY'",
          [source, identity],
        )
      )[0],
    );
    const mediaId = id('med'),
      key = 'sources/' + identity + '/' + mediaId,
      body = await getObject(m.source_key, 20 * 1024 * 1024);
    await putObject(key, body, 'image/png');
    try {
      await transaction(async (db) => {
        await this.identities.authorize(a.id, identity, 'profile', db);
        requireValue(
          (
            await query(
              "SELECT 1 FROM media WHERE id=$1 AND identity_id=$2 AND status='READY'",
              [source, identity],
              db,
            )
          )[0],
        );
        await query(
          "INSERT INTO media(id,identity_id,persona_id,source_key,bytes,alt,purpose,transforms,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PROCESSING')",
          [
            mediaId,
            identity,
            m.persona_id,
            key,
            body.length,
            d.alt,
            m.purpose,
            JSON.stringify(d.transforms),
          ],
          db,
        );
        await enqueue(db, 'media', {
          mediaId,
          identityId: identity,
          actorId: a.id,
          requestId: r.requestId,
        });
        await event(db, identity, a.id, 'media.edit_requested', r.requestId, { mediaId });
      });
    } catch (e) {
      await deleteObject(key);
      throw e;
    }
    return {
      id: mediaId,
      message: 'A new image version is processing. The original remains available.',
    };
  }
  @Get('avatar-selections') async list(@Param('identity') identity: string, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identity, 'read');
    return query(
      'SELECT id,media_id,persona_id,context,application_id,domain_id,starts_at,ends_at,revoked_at FROM avatar_selections WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100',
      [identity],
    );
  }
  @Input(AvatarControllerselectInput)
  @Post('avatar-selections')
  async select(@Param('identity') identity: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = AvatarControllerselectInput.parse(b);
    const start = new Date(d.startsAt),
      end = d.endsAt ? new Date(d.endsAt) : null;
    if (
      start.getTime() < Date.now() - 60_000 ||
      start.getTime() > Date.now() + 366 * 86_400_000 ||
      (end && (end <= start || end.getTime() > Date.now() + 366 * 86_400_000))
    )
      throw new DomainError(
        'INVALID_SCHEDULE',
        'Choose a current or future interval within one year.',
      );
    if (
      (d.context === 'DEFAULT' && (d.applicationId || d.domainId)) ||
      (d.context === 'APPLICATION' && (!d.applicationId || d.domainId)) ||
      (d.context === 'DOMAIN' && (!d.domainId || d.applicationId))
    )
      throw new DomainError('INVALID_CONTEXT', 'Select exactly the context requested.');
    const selection = id('avs');
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identity, 'profile', db);
      requireValue(
        (
          await query(
            "SELECT 1 FROM media WHERE id=$1 AND identity_id=$2 AND status='READY' AND purpose='AVATAR' AND persona_id IS NOT DISTINCT FROM $3::text",
            [d.mediaId, identity, d.personaId],
            db,
          )
        )[0],
        'Validated avatar unavailable',
      );
      if (d.personaId)
        requireValue(
          (
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
              [d.personaId, identity],
              db,
            )
          )[0],
        );
      if (d.applicationId)
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
      if (d.domainId)
        requireValue(
          (
            await query(
              'SELECT 1 FROM domains WHERE id=$1 AND identity_id=$2 AND verified_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now()',
              [d.domainId, identity],
              db,
            )
          )[0],
          'Verified domain unavailable',
        );
      if (
        (
          await query(
            'SELECT 1 FROM avatar_selections WHERE identity_id=$1 AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at>now()) OFFSET 99 LIMIT 1',
            [identity],
            db,
          )
        ).length
      )
        throw new DomainError('SCHEDULE_LIMIT', 'Cancel unused schedules before adding another.');
      const overlap = await query(
        "SELECT 1 FROM avatar_selections WHERE identity_id=$1 AND persona_id IS NOT DISTINCT FROM $2::text AND context=$3 AND application_id IS NOT DISTINCT FROM $4::text AND domain_id IS NOT DISTINCT FROM $5::text AND revoked_at IS NULL AND starts_at<COALESCE($7::timestamptz,'infinity') AND COALESCE(ends_at,'infinity')>$6::timestamptz",
        [identity, d.personaId, d.context, d.applicationId, d.domainId, start, end],
        db,
      );
      if (overlap.length)
        throw new DomainError('SCHEDULE_OVERLAP', 'Cancel the overlapping selection first.', 409);
      await query(
        'INSERT INTO avatar_selections(id,identity_id,media_id,persona_id,context,application_id,domain_id,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          selection,
          identity,
          d.mediaId,
          d.personaId,
          d.context,
          d.applicationId,
          d.domainId,
          start,
          end,
          a.id,
        ],
        db,
      );
      await event(db, identity, a.id, 'avatar.scheduled', r.requestId, { selection });
    });
    return {
      id: selection,
      message: end
        ? 'Temporary avatar scheduled. The previous avatar resumes when the interval ends.'
        : 'Avatar selection saved.',
    };
  }
  @Delete('avatar-selections/:selection') async cancel(
    @Param('identity') identity: string,
    @Param('selection') selection: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identity, 'profile', db);
      requireValue(
        (
          await query(
            'UPDATE avatar_selections SET revoked_at=now() WHERE id=$1 AND identity_id=$2 RETURNING id',
            [selection, identity],
            db,
          )
        )[0],
      );
      await event(db, identity, a.id, 'avatar.schedule_cancelled', r.requestId, { selection });
    });
    return { message: 'Selection cancelled.' };
  }
}
