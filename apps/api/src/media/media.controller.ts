import { Input } from '../input.js';
import { Controller, Get, Post, Put, Body, Param, Req, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { uploadUrl, objectExists } from '../../../../packages/core/src/storage.js';
import { enqueue, event } from '../../../../packages/core/src/events.js';
import { imageTransforms } from '../../../../packages/core/src/media-edit.js';
import { rateLimit } from '../../../../packages/core/src/redis.js';
import { requireValue, DomainError } from '../../../../packages/core/src/errors.js';
const MediaControlleruploadInput = z
  .object({
    bytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024),
    alt: z.string().trim().min(1).max(200),
    purpose: z.enum(['AVATAR', 'HEADER', 'GALLERY', 'PROJECT', 'BRANDING']).default('AVATAR'),
    personaId: z.string().nullable().default(null),
    transforms: imageTransforms.default({ rotation: 0, tolerance: 24, quality: 85 }),
  })
  .strict();
const MediaControllerpublicationInput = z.object({ enabled: z.boolean() }).strict();
@ApiTags('Media and avatars')
@Controller('api/v1/identities/:identity/media')
export class MediaController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get() async list(@Param('identity') identity: string, @Req() r: ApiRequest) {
    await this.identities.authorize(requireAccount(r).id, identity, 'read');
    return query(
      'SELECT id,status,mime,bytes,width,height,alt,variants,purpose,public_enabled,created_at FROM media WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100',
      [identity],
    );
  }
  @Input(MediaControlleruploadInput)
  @Post('upload')
  async upload(@Param('identity') identity: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = MediaControlleruploadInput.parse(b);
    const limit = await rateLimit('media:' + a.id, 20, 3600);
    if (!limit.allowed)
      throw new DomainError('UPLOAD_LIMIT', 'You have reached the hourly upload limit.', 429);
    const mediaId = id('med'),
      key = 'sources/' + identity + '/' + mediaId;
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identity, 'profile', db);
      if (d.personaId)
        requireValue(
          (
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2',
              [d.personaId, identity],
              db,
            )
          )[0],
        );
      await query(
        'INSERT INTO media(id,identity_id,persona_id,source_key,bytes,alt,purpose,transforms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          mediaId,
          identity,
          d.personaId,
          key,
          d.bytes,
          d.alt,
          d.purpose,
          JSON.stringify(d.transforms),
        ],
        db,
      );
      await event(db, identity, a.id, 'media.requested', r.requestId, { mediaId });
    });
    return {
      id: mediaId,
      url: await uploadUrl(key, d.bytes),
      headers: { 'Content-Type': 'application/octet-stream' },
    };
  }
  @Post(':id/complete') async complete(
    @Param('identity') identity: string,
    @Param('id') mediaId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await this.identities.authorize(a.id, identity, 'profile');
    const m = requireValue(
      (
        await query<{ source_key: string; status: string; bytes: number }>(
          'SELECT source_key,status,bytes FROM media WHERE id=$1 AND identity_id=$2',
          [mediaId, identity],
        )
      )[0],
    );
    const metadata = await objectExists(m.source_key);
    if (metadata.ContentLength !== m.bytes) {
      await transaction(async (db) => {
        await this.identities.authorize(a.id, identity, 'profile', db);
        await query(
          "UPDATE media SET status='REJECTED' WHERE id=$1 AND status='PENDING'",
          [mediaId],
          db,
        );
        await enqueue(db, 'delete-objects', { keys: [m.source_key] });
      });
      throw new DomainError(
        'UPLOAD_SIZE_MISMATCH',
        'The uploaded byte count does not match the signed request.',
      );
    }
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identity, 'profile', db);
      const rows = await query(
        "UPDATE media SET status='PROCESSING' WHERE id=$1 AND status='PENDING' RETURNING id",
        [mediaId],
        db,
      );
      if (rows.length)
        await enqueue(db, 'media', {
          mediaId,
          identityId: identity,
          actorId: a.id,
          requestId: r.requestId,
        });
    });
    return { message: 'Image is being validated and processed.' };
  }
  @Input(MediaControllerpublicationInput)
  @Put(':id/publication')
  async publication(
    @Param('identity') identity: string,
    @Param('id') mediaId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const { enabled } = MediaControllerpublicationInput.parse(b),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identity, 'profile', db);
      const m = requireValue(
        (
          await query<{ purpose: string }>(
            "SELECT purpose FROM media WHERE id=$1 AND identity_id=$2 AND status='READY' FOR UPDATE",
            [mediaId, identity],
            db,
          )
        )[0],
        'Validated media unavailable',
      );
      await this.identities.snapshot(db, identity, accountId);
      await query('UPDATE media SET public_enabled=$2 WHERE id=$1', [mediaId, enabled], db);
      if (m.purpose === 'HEADER') {
        await query(
          'UPDATE identities SET header_media_id=$2 WHERE id=$1 AND ($2::text IS NOT NULL OR header_media_id=$3)',
          [identity, enabled ? mediaId : null, mediaId],
          db,
        );
      }
      await event(db, identity, accountId, 'media.publication_changed', r.requestId, {
        mediaId,
        enabled,
      });
    });
    return {
      message: enabled
        ? 'Validated media published under the current identity visibility.'
        : 'Media publication revoked.',
      url: '/assets/' + mediaId + '/512.webp',
    };
  }
  @Put(':id/activate') async activate(
    @Param('identity') identity: string,
    @Param('id') mediaId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identity, 'profile', db);
      const m = requireValue(
        (
          await query<{ status: string; persona_id: string | null; purpose: string }>(
            'SELECT status,persona_id,purpose FROM media WHERE id=$1 AND identity_id=$2',
            [mediaId, identity],
            db,
          )
        )[0],
      );
      if (m.status !== 'READY' || m.purpose !== 'AVATAR')
        throw new DomainError('MEDIA_UNAVAILABLE', 'This image has not passed processing.');
      await this.identities.snapshot(db, identity, a.id);
      await query(
        "UPDATE avatar_selections SET revoked_at=now() WHERE identity_id=$1 AND persona_id IS NOT DISTINCT FROM $2::text AND context='DEFAULT' AND revoked_at IS NULL",
        [identity, m.persona_id],
        db,
      );
      if (m.persona_id)
        await query(
          'UPDATE personas SET avatar_media_id=$1 WHERE id=$2',
          [mediaId, m.persona_id],
          db,
        );
      else
        await query(
          'UPDATE identities SET avatar_media_id=$1 WHERE id=$2',
          [mediaId, identity],
          db,
        );
      await event(db, identity, a.id, 'avatar.updated', r.requestId, { mediaId });
    });
    return { message: 'Avatar updated' };
  }
}
