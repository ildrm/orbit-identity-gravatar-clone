import { Input } from '../input.js';
import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { rateLimit } from '../../../../packages/core/src/redis.js';
import { id } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { config } from '../../../../packages/core/src/config.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
function moderator(r: ApiRequest) {
  const a = requireAccount(r);
  if (
    !config()
      .MODERATOR_EMAILS.split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(a.email)
  )
    throw new DomainError('FORBIDDEN', 'Moderator access required.', 403);
  return a;
}
const ModerationControllerreportInput = z
  .object({
    identityId: z.string().max(100),
    category: z.enum([
      'IMPERSONATION',
      'SPAM',
      'MALICIOUS_LINK',
      'STOLEN_IMAGE',
      'TRADEMARK',
      'OTHER',
    ]),
    description: z.string().min(20).max(3000),
  })
  .strict();
const ModerationControllerdispositionInput = z
  .object({
    state: z.enum(['RESOLVED', 'DISMISSED']),
    action: z.enum(['NONE', 'RESTRICT', 'SUSPEND', 'RESTORE']),
    reason: z.string().min(20).max(2000),
  })
  .strict();
@ApiTags('Moderation')
@Controller('api/v1')
export class ModerationController {
  @Input(ModerationControllerreportInput)
  @Post('reports')
  async report(@Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = ModerationControllerreportInput.parse(b);
    requireValue(
      (
        await query(
          "SELECT 1 FROM identities WHERE id=$1 AND visibility<>'PRIVATE' AND state<>'DELETED'",
          [d.identityId],
        )
      )[0],
    );
    if (!(await rateLimit('reports:' + a.id, 10, 86400)).allowed)
      throw new DomainError('REPORT_LIMIT', 'Daily report limit reached.', 429);
    const reportId = id('rpt');
    await query(
      'INSERT INTO reports(id,identity_id,reporter_id,category,description) VALUES($1,$2,$3,$4,$5)',
      [reportId, d.identityId, a.id, d.category, d.description],
    );
    return { id: reportId, message: 'Report submitted for review.' };
  }
  @Get('admin/reports') reports(@Req() r: ApiRequest) {
    moderator(r);
    return query(
      'SELECT r.*,i.handle FROM reports r JOIN identities i ON i.id=r.identity_id ORDER BY r.created_at DESC LIMIT 100',
    );
  }
  @Get('admin/me') me(@Req() r: ApiRequest) {
    return moderator(r);
  }
  @Input(ModerationControllerdispositionInput)
  @Post('admin/reports/:id')
  async disposition(@Param('id') reportId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = moderator(r),
      d = ModerationControllerdispositionInput.parse(b);
    await transaction(async (db) => {
      const report = requireValue(
        (
          await query<{ identity_id: string }>(
            "SELECT identity_id FROM reports WHERE id=$1 AND state='OPEN' FOR UPDATE",
            [reportId],
            db,
          )
        )[0],
      );
      await query(
        'UPDATE reports SET state=$1,disposition=$2,moderator_id=$3 WHERE id=$4',
        [d.state, d.reason, a.id, reportId],
        db,
      );
      if (d.action !== 'NONE') {
        const state = { RESTRICT: 'RESTRICTED', SUSPEND: 'SUSPENDED', RESTORE: 'ACTIVE' }[d.action];
        const affected = await query(
          'UPDATE identities SET state=$1 WHERE id=$2 AND state=ANY($3::text[]) RETURNING id',
          [
            state,
            report.identity_id,
            d.action === 'RESTORE'
              ? ['RESTRICTED', 'SUSPENDED']
              : ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'MEMORIALIZED', 'FROZEN'],
          ],
          db,
        );
        if (!affected.length)
          throw new DomainError(
            'INVALID_TRANSITION',
            'This action does not apply to the current identity state.',
            409,
          );
      }
      await event(db, report.identity_id, a.id, 'moderation.disposition', r.requestId, {
        reportId,
        action: d.action,
        reason: d.reason,
      });
    });
    return { message: 'Review recorded' };
  }
}
