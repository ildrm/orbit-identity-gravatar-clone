import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { config } from '../../../../packages/core/src/config.js';
import { id } from '../../../../packages/core/src/security.js';
import { event, audit } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { requireAccount, type ApiRequest } from '../http.js';
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
const hostSchema = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const AppealsControllerappealInput = z
  .object({ reportId: z.string().max(100), reason: z.string().trim().min(50).max(3000) })
  .strict();
const AppealsControllerreviewInput = z
  .object({
    decision: z.enum(['UPHELD', 'OVERTURNED']),
    reason: z.string().trim().min(50).max(3000),
  })
  .strict();
const AppealsControllerblockInput = z
  .object({ host: hostSchema, reason: z.string().min(20).max(2000) })
  .strict();
@ApiTags('Moderation appeals and link safety')
@Controller('api/v1')
export class AppealsController {
  @Get('identities/:id/moderation') async cases(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    requireValue(
      (
        await query(
          "SELECT 1 FROM memberships WHERE identity_id=$1 AND account_id=$2 AND role='OWNER'",
          [identityId, requireAccount(r).id],
        )
      )[0],
      'Owner access required',
    );
    return {
      reports: await query(
        "SELECT id,category,state,disposition,created_at FROM reports WHERE identity_id=$1 AND state<>'OPEN' ORDER BY created_at DESC LIMIT 100",
        [identityId],
      ),
      appeals: await query(
        'SELECT id,report_id,reason,state,disposition,created_at,reviewed_at FROM moderation_appeals WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100',
        [identityId],
      ),
    };
  }
  @Input(AppealsControllerappealInput)
  @Post('identities/:id/appeals')
  async appeal(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = AppealsControllerappealInput.parse(b),
      a = requireAccount(r),
      appealId = id('apl');
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT 1 FROM memberships m JOIN identities i ON i.id=m.identity_id WHERE m.identity_id=$1 AND m.account_id=$2 AND m.role='OWNER' AND i.state NOT IN ('DELETED','MERGED','TRANSFERRED') FOR UPDATE OF i",
            [identityId, a.id],
            db,
          )
        )[0],
        'Current owner access required',
      );
      requireValue(
        (
          await query(
            "SELECT 1 FROM reports WHERE id=$1 AND identity_id=$2 AND state='RESOLVED'",
            [d.reportId, identityId],
            db,
          )
        )[0],
        'Resolved moderation decision unavailable',
      );
      await query(
        'INSERT INTO moderation_appeals(id,report_id,identity_id,account_id,reason) VALUES($1,$2,$3,$4,$5)',
        [appealId, d.reportId, identityId, a.id, d.reason],
        db,
      );
      await event(db, identityId, a.id, 'moderation.appealed', r.requestId, { appealId });
    });
    return { id: appealId, message: 'Appeal submitted for independent review.' };
  }
  @Get('admin/appeals') queue(@Req() r: ApiRequest) {
    moderator(r);
    return query(
      "SELECT a.*,r.category,r.disposition AS original_disposition FROM moderation_appeals a JOIN reports r ON r.id=a.report_id WHERE a.state='OPEN' ORDER BY a.created_at LIMIT 100",
    );
  }
  @Input(AppealsControllerreviewInput)
  @Post('admin/appeals/:id')
  async review(@Param('id') appealId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = moderator(r),
      d = AppealsControllerreviewInput.parse(b);
    await transaction(async (db) => {
      const appeal = requireValue(
        (
          await query<{
            identity_id: string;
            account_id: string;
            moderator_id: string;
            state: string;
          }>(
            "SELECT a.*,r.moderator_id FROM moderation_appeals a JOIN reports r ON r.id=a.report_id WHERE a.id=$1 AND a.state='OPEN' FOR UPDATE OF a,r",
            [appealId],
            db,
          )
        )[0],
        'Open appeal unavailable',
      );
      if (a.id === appeal.account_id || a.id === appeal.moderator_id)
        throw new DomainError('REVIEW_CONFLICT', 'Appeals require an independent reviewer.', 403);
      await query(
        'UPDATE moderation_appeals SET state=$2,reviewer_id=$3,disposition=$4,reviewed_at=now() WHERE id=$1',
        [appealId, d.decision, a.id, d.reason],
        db,
      );
      if (d.decision === 'OVERTURNED') {
        const affected = await query(
          "UPDATE identities SET state='ACTIVE',visibility='PRIVATE',searchable=false,indexable=false,machine=false,agent=false,federation_enabled=false WHERE id=$1 AND state IN ('RESTRICTED','SUSPENDED') RETURNING id",
          [appeal.identity_id],
          db,
        );
        if (!affected.length)
          throw new DomainError(
            'INVALID_TRANSITION',
            'Only moderation restrictions can be overturned here.',
            409,
          );
      }
      await event(db, appeal.identity_id, a.id, 'moderation.appeal_reviewed', r.requestId, {
        appealId,
        decision: d.decision,
        reason: d.reason,
      });
    });
    return { message: 'Independent appeal decision recorded. Restored identities remain private.' };
  }
  @Get('admin/link-hosts') hosts(@Req() r: ApiRequest) {
    moderator(r);
    return query('SELECT host,reason,created_at FROM blocked_link_hosts ORDER BY host LIMIT 1000');
  }
  @Input(AppealsControllerblockInput)
  @Post('admin/link-hosts')
  async block(@Body() b: unknown, @Req() r: ApiRequest) {
    const a = moderator(r),
      d = AppealsControllerblockInput.parse(b);
    await transaction(async (db) => {
      await query('SELECT pg_advisory_xact_lock(718209)', [], db);
      if (
        !(await query('SELECT 1 FROM blocked_link_hosts WHERE host=$1', [d.host], db)).length &&
        (await query('SELECT 1 FROM blocked_link_hosts OFFSET 9999 LIMIT 1', [], db)).length
      )
        throw new DomainError('HOST_LIMIT', 'Remove unused blocks before adding another host.');
      await query(
        'INSERT INTO blocked_link_hosts(host,reason,actor_id) VALUES($1,$2,$3) ON CONFLICT(host) DO UPDATE SET reason=EXCLUDED.reason,actor_id=EXCLUDED.actor_id',
        [d.host, d.reason, a.id],
        db,
      );
      await query(
        "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(i.id||$1),'event',jsonb_build_object('id','evt_'||md5(i.id||$1),'identityId',i.id,'type','profile.updated') FROM identities i WHERE i.federation_enabled AND i.state='ACTIVE' ON CONFLICT DO NOTHING",
        [r.requestId],
        db,
      );
      await audit(db, a.id, null, 'link_host.blocked', r.requestId, { host: d.host });
    });
    return { message: 'Host and its subdomains blocked from clickable public profile content.' };
  }
  @Delete('admin/link-hosts/:host') async unblock(
    @Param('host') host: string,
    @Req() r: ApiRequest,
  ) {
    const a = moderator(r);
    await transaction(async (db) => {
      await query('DELETE FROM blocked_link_hosts WHERE host=$1', [hostSchema.parse(host)], db);
      await query(
        "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(i.id||$1),'event',jsonb_build_object('id','evt_'||md5(i.id||$1),'identityId',i.id,'type','profile.updated') FROM identities i WHERE i.federation_enabled AND i.state='ACTIVE' ON CONFLICT DO NOTHING",
        [r.requestId],
        db,
      );
      await audit(db, a.id, null, 'link_host.unblocked', r.requestId, { host });
    });
    return { message: 'Link host block removed.' };
  }
}
