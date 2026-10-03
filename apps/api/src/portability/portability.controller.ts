import { Input } from '../input.js';
import { purgeIdentity } from '../../../../packages/core/src/lifecycle.js';
import { recordAggregate } from '../../../../packages/core/src/analytics.js';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  Inject,
  Res,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { enqueue, event } from '../../../../packages/core/src/events.js';
import { requireValue, DomainError } from '../../../../packages/core/src/errors.js';
import { downloadUrl } from '../../../../packages/core/src/storage.js';
import { config } from '../../../../packages/core/src/config.js';
const PortabilityControllerremoveInput = z.object({ confirmation: z.string() }).strict();
const PortabilityControllercreateQrInput = z
  .object({
    personaId: z.string().nullable().default(null),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
@ApiTags('Portability, sharing and lifecycle')
@Controller()
export class PortabilityController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Post('api/v1/identities/:id/exports') async export(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r),
      exportId = id('exp');
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'security', db);
      await query(
        "INSERT INTO exports(id,identity_id,account_id,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",
        [exportId, identityId, a.id],
        db,
      );
      await enqueue(db, 'export', { exportId, identityId, accountId: a.id });
      await event(db, identityId, a.id, 'identity.exported', r.requestId);
    });
    return { id: exportId, status: 'PENDING' };
  }
  @Get('api/v1/identities/:id/exports') async exports(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return query(
      'SELECT id,status,expires_at,created_at FROM exports WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 50',
      [identityId],
    );
  }
  @Get('api/v1/exports/:id/download') async download(
    @Param('id') exportId: string,
    @Query('format') format: string | undefined,
    @Req() r: ApiRequest,
  ) {
    const e = requireValue(
      (
        await query<{ identity_id: string; object_key: string; archive_key: string | null }>(
          "SELECT identity_id,object_key,archive_key FROM exports WHERE id=$1 AND account_id=$2 AND status='READY' AND expires_at>now()",
          [exportId, requireAccount(r).id],
        )
      )[0],
    );
    await this.identities.authorize(requireAccount(r).id, e.identity_id, 'security');
    if (format && format !== 'archive' && format !== 'json')
      throw new DomainError('INVALID_FORMAT', 'Choose json or archive.');
    if (format === 'archive' && !e.archive_key)
      throw new DomainError(
        'ARCHIVE_UNAVAILABLE',
        'Generate a new export to include its media archive.',
      );
    return { url: await downloadUrl(format === 'archive' ? e.archive_key! : e.object_key) };
  }
  @Input(PortabilityControllerremoveInput)
  @Delete('api/v1/identities/:id')
  async remove(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      { confirmation } = PortabilityControllerremoveInput.parse(b);
    await transaction(async (db) => {
      const identity = await this.identities.authorize(a.id, identityId, 'delete', db);
      if (confirmation !== identity.handle)
        throw new DomainError(
          'CONFIRMATION_REQUIRED',
          'Type the current handle to confirm deletion.',
        );
      await purgeIdentity(db, identityId, a.id, r.requestId);
    });
    return { message: 'Identity deleted. Its handles remain reserved to prevent impersonation.' };
  }
  @Input(PortabilityControllercreateQrInput)
  @Post('api/v1/identities/:id/qr')
  async createQr(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = PortabilityControllercreateQrInput.parse(b);
    await this.identities.authorize(a.id, identityId, 'profile');
    if (d.personaId)
      requireValue(
        (
          await query('SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active', [
            d.personaId,
            identityId,
          ])
        )[0],
      );
    const qrId = id('qr');
    await query('INSERT INTO qr_codes(id,identity_id,persona_id,expires_at) VALUES($1,$2,$3,$4)', [
      qrId,
      identityId,
      d.personaId,
      d.expiresAt,
    ]);
    const url = config().PUBLIC_ORIGIN + '/q/' + qrId;
    return {
      id: qrId,
      url,
      svg: await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M' }),
    };
  }
  @Get('q/:id') async redirect(
    @Param('id') qrId: string,
    @Req() r: ApiRequest,
    @Res() res: Response,
  ) {
    const q = requireValue(
      (
        await query<{ identity_id: string; slug: string | null }>(
          'SELECT q.identity_id,p.slug FROM qr_codes q LEFT JOIN personas p ON p.id=q.persona_id WHERE q.id=$1 AND q.revoked_at IS NULL AND (q.expires_at IS NULL OR q.expires_at>now())',
          [qrId],
        )
      )[0],
    );
    const p = await this.identities.profile(q.identity_id, q.slug, 'human');
    await recordAggregate(p.id, 'qr_scan', r.headers.dnt === '1' || r.headers['sec-gpc'] === '1');
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(
      302,
      config().PUBLIC_ORIGIN +
        '/u/' +
        p.handle +
        (q.slug ? '?persona=' + encodeURIComponent(q.slug) : ''),
    );
  }
}
