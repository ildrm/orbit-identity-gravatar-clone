import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { audit } from '../../../../packages/core/src/events.js';
const NotificationsControllerconfigureInput = z
  .object({ inApp: z.boolean(), email: z.boolean() })
  .strict();
@Controller('api/v1/notifications')
export class NotificationsController {
  @Get() list(@Req() r: ApiRequest) {
    return query(
      'SELECT id,identity_id,kind,created_at,read_at FROM notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',
      [requireAccount(r).id],
    );
  }
  @Get('preferences') async preferences(@Req() r: ApiRequest) {
    return (
      (
        await query('SELECT in_app,email FROM notification_preferences WHERE account_id=$1', [
          requireAccount(r).id,
        ])
      )[0] ?? { in_app: true, email: false }
    );
  }
  @Input(NotificationsControllerconfigureInput)
  @Put('preferences')
  async configure(@Body() b: unknown, @Req() r: ApiRequest) {
    const d = NotificationsControllerconfigureInput.parse(b),
      a = requireAccount(r);
    await transaction(async (db) => {
      await query(
        'INSERT INTO notification_preferences(account_id,in_app,email) VALUES($1,$2,$3) ON CONFLICT(account_id) DO UPDATE SET in_app=EXCLUDED.in_app,email=EXCLUDED.email',
        [a.id, d.inApp, d.email],
        db,
      );
      if (!d.inApp) await query('DELETE FROM notifications WHERE account_id=$1', [a.id], db);
      await audit(db, a.id, null, 'notifications.configured', r.requestId);
    });
    return { message: 'Notification preferences saved.' };
  }
  @Put(':id/read') async read(@Param('id') notificationId: string, @Req() r: ApiRequest) {
    await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND account_id=$2', [
      notificationId,
      requireAccount(r).id,
    ]);
    return { message: 'Notification read.' };
  }
  @Delete() async clear(@Req() r: ApiRequest) {
    await query('DELETE FROM notifications WHERE account_id=$1', [requireAccount(r).id]);
    return { message: 'Notifications cleared.' };
  }
}
