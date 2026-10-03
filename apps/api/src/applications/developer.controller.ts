import { Input } from '../input.js';
import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction, type DB } from '../../../../packages/core/src/db.js';
import { audit, enqueue } from '../../../../packages/core/src/events.js';
import { id, encrypt, secret } from '../../../../packages/core/src/security.js';
import { rateLimit } from '../../../../packages/core/src/redis.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
async function owned(application: string, r: ApiRequest, db?: DB) {
  requireValue(
    (
      await query(
        'SELECT 1 FROM applications WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL' +
          (db ? ' FOR UPDATE' : ''),
        [application, requireAccount(r).id],
        db,
      )
    )[0],
    'Current application owner required',
  );
}
const DeveloperControllersettingsInput = z.object({ enabled: z.boolean() }).strict();
@Controller('api/v1/applications/:application')
export class DeveloperController {
  @Get('usage') async usage(@Param('application') app: string, @Req() r: ApiRequest) {
    await owned(app, r);
    return {
      retentionDays: 30,
      access: await query(
        "SELECT operation,count(*)::int AS requests FROM application_access_logs WHERE application_id=$1 AND created_at>now()-interval '30 days' GROUP BY operation",
        [app],
      ),
      grants: await query(
        'SELECT count(*)::int AS total,count(*) FILTER(WHERE revoked_at IS NULL AND expires_at>now())::int AS active FROM consents WHERE application_id=$1',
        [app],
      ),
    };
  }
  @Get('logs') async logs(@Param('application') app: string, @Req() r: ApiRequest) {
    await owned(app, r);
    return query(
      'SELECT id,operation,request_id,created_at FROM application_access_logs WHERE application_id=$1 ORDER BY created_at DESC LIMIT 100',
      [app],
    );
  }
  @Get('deliveries') async deliveries(@Param('application') app: string, @Req() r: ApiRequest) {
    await owned(app, r);
    return query(
      "SELECT j.id,j.status,j.attempts,j.last_error,j.run_after,j.created_at,j.completed_at,j.payload->>'deliveryId' AS delivery_id,w.id AS webhook_id FROM jobs j JOIN webhooks w ON w.id=j.payload->>'webhookId' WHERE j.kind='webhook' AND w.application_id=$1 ORDER BY j.created_at DESC LIMIT 100",
      [app],
    );
  }
  @Input(DeveloperControllersettingsInput)
  @Put('webhooks/:hook/settings')
  async settings(
    @Param('application') app: string,
    @Param('hook') hook: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const { enabled } = DeveloperControllersettingsInput.parse(b);
    await transaction(async (db) => {
      await owned(app, r, db);
      requireValue(
        (
          await query(
            'UPDATE webhooks SET enabled=$3,failures=CASE WHEN $3 THEN 0 ELSE failures END WHERE id=$1 AND application_id=$2 RETURNING id',
            [hook, app, enabled],
            db,
          )
        )[0],
      );
      await audit(db, requireAccount(r).id, null, 'webhook.settings_changed', r.requestId, {
        applicationId: app,
        webhookId: hook,
        enabled,
      });
    });
    return { message: 'Webhook settings saved.' };
  }
  @Post('webhooks/:hook/rotate') async rotate(
    @Param('application') app: string,
    @Param('hook') hook: string,
    @Req() r: ApiRequest,
  ) {
    const value = secret();
    await transaction(async (db) => {
      await owned(app, r, db);
      requireValue(
        (
          await query(
            'UPDATE webhooks SET secret_encrypted=$3 WHERE id=$1 AND application_id=$2 RETURNING id',
            [hook, app, encrypt(value)],
            db,
          )
        )[0],
      );
      await audit(db, requireAccount(r).id, null, 'webhook.secret_rotated', r.requestId, {
        applicationId: app,
        webhookId: hook,
      });
    });
    return {
      secret: value,
      message: 'Save this signing secret now. Pending deliveries use the current secret.',
    };
  }
  @Post('webhooks/:hook/test') async test(
    @Param('application') app: string,
    @Param('hook') hook: string,
    @Req() r: ApiRequest,
  ) {
    if (!(await rateLimit('webhook-test:' + requireAccount(r).id, 10, 3600)).allowed)
      throw new DomainError('RATE_LIMITED', 'Webhook test hourly limit reached.', 429);
    let jobId = '';
    await transaction(async (db) => {
      await owned(app, r, db);
      requireValue(
        (
          await query(
            'SELECT 1 FROM webhooks WHERE id=$1 AND application_id=$2 AND enabled',
            [hook, app],
            db,
          )
        )[0],
      );
      jobId = await enqueue(db, 'webhook', {
        webhookId: hook,
        deliveryId: id('dlv'),
        test: true,
        event: { id: id('evt'), type: 'webhook.test', occurredAt: new Date().toISOString() },
      });
      await audit(db, requireAccount(r).id, null, 'webhook.test_requested', r.requestId, {
        applicationId: app,
        webhookId: hook,
      });
    });
    return { id: jobId, message: 'Signed test event queued.' };
  }
  @Post('deliveries/:delivery/replay') async replay(
    @Param('application') app: string,
    @Param('delivery') job: string,
    @Req() r: ApiRequest,
  ) {
    if (!(await rateLimit('webhook-replay:' + requireAccount(r).id, 20, 3600)).allowed)
      throw new DomainError('RATE_LIMITED', 'Webhook replay hourly limit reached.', 429);
    await transaction(async (db) => {
      await owned(app, r, db);
      requireValue(
        (
          await query(
            "UPDATE jobs j SET status='PENDING',run_after=now(),attempts=0,lease_token=NULL,lease_until=NULL,completed_at=NULL WHERE j.id=$1 AND j.kind='webhook' AND j.status IN ('DEAD','COMPLETED') AND EXISTS(SELECT 1 FROM webhooks w WHERE w.id=j.payload->>'webhookId' AND w.application_id=$2 AND w.enabled) RETURNING j.id",
            [job, app],
            db,
          )
        )[0],
        'Replayable delivery unavailable',
      );
      await audit(db, requireAccount(r).id, null, 'webhook.replayed', r.requestId, {
        applicationId: app,
        jobId: job,
      });
    });
    return {
      message:
        'Delivery replay queued with its original idempotency ID. Current authorization will be checked before sending.',
    };
  }
}
