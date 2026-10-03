import { Input } from '../input.js';
import { Body, Controller, Delete, Get, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { audit, enqueue } from '../../../../packages/core/src/events.js';
import { purgeIdentity } from '../../../../packages/core/src/lifecycle.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { emailSchema, passwordSchema } from '../../../../packages/contracts/src/index.js';
import { AuthService } from './auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const proofSchema = z.string().min(20).max(200);
const AccountControllersettingsInput = z
  .object({ locale: z.enum(['en', 'fa', 'ar']), timezone: z.string().max(100) })
  .strict();
const AccountControllerpasswordInput = z
  .object({ password: passwordSchema, proof: proofSchema })
  .strict();
const AccountControllerdisableTotpInput = z.object({ proof: proofSchema }).strict();
const AccountControllerbackupCodesInput = z.object({ proof: proofSchema }).strict();
const AccountControlleremailInput = z.object({ email: emailSchema, proof: proofSchema }).strict();
const AccountControllerconfirmEmailInput = z
  .object({ token: z.string().min(20).max(200) })
  .strict();
const AccountControllerremoveInput = z
  .object({
    confirmEmail: emailSchema,
    deleteOwnedIdentities: z.literal(true),
    proof: proofSchema,
  })
  .strict();
@ApiTags('Account lifecycle')
@Controller('api/v1/account')
export class AccountController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Input(AccountControllersettingsInput)
  @Patch('settings')
  async settings(@Body() b: unknown, @Req() r: ApiRequest) {
    const d = AccountControllersettingsInput.parse(b),
      account = requireAccount(r);
    try {
      new Intl.DateTimeFormat('en', { timeZone: d.timezone }).format();
    } catch {
      throw new DomainError('INVALID_TIMEZONE', 'Choose a valid IANA timezone.');
    }
    await transaction(async (db) => {
      await query(
        "UPDATE accounts SET locale=$2,timezone=$3 WHERE id=$1 AND state='ACTIVE'",
        [account.id, d.locale, d.timezone],
        db,
      );
      await audit(db, account.id, null, 'account.settings_updated', r.requestId);
    });
    return { locale: d.locale, timezone: d.timezone };
  }
  @Input(AccountControllerpasswordInput)
  @Post('password')
  async password(
    @Body() b: unknown,
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = AccountControllerpasswordInput.parse(b),
      account = requireAccount(r);
    await this.auth.requireStepUp(account.id, d.proof);
    const hash = await argon2.hash(d.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "UPDATE accounts SET password_hash=$2 WHERE id=$1 AND state='ACTIVE' RETURNING id",
            [account.id, hash],
            db,
          )
        )[0],
        'Account unavailable',
      );
      await query('UPDATE sessions SET revoked_at=now() WHERE account_id=$1', [account.id], db);
      await query(
        'UPDATE challenges SET used_at=now(),data=$2 WHERE account_id=$1',
        [account.id, '{}'],
        db,
      );
      await audit(db, account.id, null, 'account.password_changed', r.requestId);
    });
    res.clearCookie('identity_session', { path: '/' });
    return { message: 'Password changed. Sign in again on each device.' };
  }
  @Input(AccountControllerdisableTotpInput)
  @Post('totp/disable')
  async disableTotp(@Body() b: unknown, @Req() r: ApiRequest) {
    const { proof } = AccountControllerdisableTotpInput.parse(b),
      account = requireAccount(r);
    await this.auth.requireStepUp(account.id, proof);
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT 1 FROM accounts WHERE id=$1 AND state='ACTIVE' FOR UPDATE",
            [account.id],
            db,
          )
        )[0],
        'Account unavailable',
      );
      await query(
        "UPDATE accounts SET totp_secret=NULL,totp_enabled=false WHERE id=$1 AND state='ACTIVE'",
        [account.id],
        db,
      );
      await query('DELETE FROM backup_codes WHERE account_id=$1', [account.id], db);
      await audit(db, account.id, null, 'account.totp_disabled', r.requestId);
    });
    return { message: 'Authenticator and backup codes removed.' };
  }
  @Input(AccountControllerbackupCodesInput)
  @Post('backup-codes')
  async backupCodes(@Body() b: unknown, @Req() r: ApiRequest) {
    const { proof } = AccountControllerbackupCodesInput.parse(b),
      account = requireAccount(r);
    await this.auth.requireStepUp(account.id, proof);
    const codes = Array.from({ length: 10 }, () => secret().slice(0, 16));
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT id FROM accounts WHERE id=$1 AND state='ACTIVE' AND totp_enabled FOR UPDATE",
            [account.id],
            db,
          )
        )[0],
        'Enable an authenticator first',
      );
      await query('DELETE FROM backup_codes WHERE account_id=$1', [account.id], db);
      for (const code of codes)
        await query(
          'INSERT INTO backup_codes(account_id,digest) VALUES($1,$2)',
          [account.id, digest(code)],
          db,
        );
      await audit(db, account.id, null, 'account.backup_codes_rotated', r.requestId);
    });
    return { backupCodes: codes };
  }
  @Input(AccountControlleremailInput)
  @Post('email')
  async email(@Body() b: unknown, @Req() r: ApiRequest) {
    const d = AccountControlleremailInput.parse(b),
      account = requireAccount(r),
      token = secret();
    await this.auth.requireStepUp(account.id, d.proof);
    if (d.email === account.email)
      throw new DomainError('EMAIL_UNCHANGED', 'Choose a different address.');
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT 1 FROM accounts WHERE id=$1 AND state='ACTIVE' FOR UPDATE",
            [account.id],
            db,
          )
        )[0],
        'Account unavailable',
      );
      if ((await query('SELECT 1 FROM accounts WHERE email=$1', [d.email], db)).length)
        throw new DomainError('EMAIL_UNAVAILABLE', 'This address cannot be used.', 409);
      await query(
        "UPDATE challenges SET used_at=now(),data='{}' WHERE account_id=$1 AND kind='CHANGE_EMAIL'",
        [account.id],
        db,
      );
      await query(
        "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'CHANGE_EMAIL',$3,$4,now()+interval '30 minutes')",
        [id('chl'), account.id, digest(token), JSON.stringify({ email: d.email })],
        db,
      );
      await enqueue(db, 'email', {
        to: d.email,
        template: 'change-email',
        token,
        accountId: account.id,
      });
      await audit(db, account.id, null, 'account.email_change_requested', r.requestId);
    });
    return { message: 'Verification sent. Confirm the code while signed in to this account.' };
  }
  @Input(AccountControllerconfirmEmailInput)
  @Post('email/confirm')
  async confirmEmail(@Body() b: unknown, @Req() r: ApiRequest) {
    const { token } = AccountControllerconfirmEmailInput.parse(b),
      account = requireAccount(r);
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT 1 FROM accounts WHERE id=$1 AND state='ACTIVE' FOR UPDATE",
            [account.id],
            db,
          )
        )[0],
        'Account unavailable',
      );
      const c = requireValue(
        (
          await query<{ data: { email: string } }>(
            "UPDATE challenges SET used_at=now() WHERE account_id=$1 AND digest=$2 AND kind='CHANGE_EMAIL' AND expires_at>now() AND used_at IS NULL RETURNING data",
            [account.id, digest(token)],
            db,
          )
        )[0],
        'Verification expired or used',
      );
      if ((await query('SELECT 1 FROM accounts WHERE email=$1', [c.data.email], db)).length)
        throw new DomainError('EMAIL_UNAVAILABLE', 'This address cannot be used.', 409);
      await query(
        "UPDATE accounts SET email=$2,verified_at=now() WHERE id=$1 AND state='ACTIVE'",
        [account.id, c.data.email],
        db,
      );
      await query('UPDATE consents SET revoked_at=now() WHERE account_id=$1', [account.id], db);
      await audit(db, account.id, null, 'account.email_changed', r.requestId);
    });
    return { message: 'Verified email changed. Existing application grants were revoked.' };
  }
  @Get('deletion-preview') async preview(@Req() r: ApiRequest) {
    return {
      identities: await query(
        "SELECT i.id,i.handle,i.type,(SELECT count(*) FROM memberships x WHERE x.identity_id=i.id AND x.role='OWNER') AS owners FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE m.account_id=$1 AND m.role='OWNER' AND i.state NOT IN ('DELETED','MERGED') ORDER BY i.id",
        [requireAccount(r).id],
      ),
      message:
        'Solely owned identities will be deleted. Identities with other owners survive under those owners. Export your data or transfer ownership first.',
    };
  }
  @Input(AccountControllerremoveInput)
  @Delete()
  async remove(
    @Body() b: unknown,
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = AccountControllerremoveInput.parse(b),
      account = requireAccount(r);
    if (d.confirmEmail !== account.email)
      throw new DomainError('CONFIRMATION_MISMATCH', 'Type your current verified email.');
    await this.auth.requireStepUp(account.id, d.proof);
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            "SELECT id FROM accounts WHERE id=$1 AND email=$2 AND state='ACTIVE' FOR UPDATE",
            [account.id, d.confirmEmail],
            db,
          )
        )[0],
        'Account unavailable',
      );
      const owned = await query<{ id: string }>(
        "SELECT i.id FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE m.account_id=$1 AND m.role='OWNER' AND i.state NOT IN ('DELETED','MERGED') ORDER BY i.id FOR UPDATE OF i",
        [account.id],
        db,
      );
      for (const identity of owned)
        if (
          !(
            await query(
              "SELECT 1 FROM memberships WHERE identity_id=$1 AND role='OWNER' AND account_id<>$2",
              [identity.id, account.id],
              db,
            )
          ).length
        )
          await purgeIdentity(db, identity.id, account.id, r.requestId);
      await query('UPDATE consents SET revoked_at=now() WHERE account_id=$1', [account.id], db);
      await query(
        'UPDATE consents SET revoked_at=now() WHERE application_id IN (SELECT id FROM applications WHERE account_id=$1)',
        [account.id],
        db,
      );
      await query(
        'UPDATE applications SET revoked_at=now(),key_digest=NULL,oauth_secret_digest=NULL WHERE account_id=$1',
        [account.id],
        db,
      );
      await query(
        'UPDATE webhooks SET enabled=false,secret_encrypted=$2 WHERE application_id IN (SELECT id FROM applications WHERE account_id=$1)',
        [account.id, ''],
        db,
      );
      await query(
        "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE actor_id=$1",
        [account.id],
        db,
      );
      await query(
        'UPDATE legacy_policies SET revoked_at=now() WHERE owner_id=$1 OR custodian_id=$1',
        [account.id],
        db,
      );
      await query(
        "UPDATE legacy_requests SET state='VETOED',evidence_encrypted='' WHERE state IN ('PENDING','APPROVED') AND (requester_id=$1 OR identity_id IN (SELECT identity_id FROM legacy_policies WHERE owner_id=$1 OR custodian_id=$1))",
        [account.id],
        db,
      );
      await query('DELETE FROM memberships WHERE account_id=$1', [account.id], db);
      await query('DELETE FROM passkeys WHERE account_id=$1', [account.id], db);
      await query('DELETE FROM backup_codes WHERE account_id=$1', [account.id], db);
      await query('DELETE FROM notifications WHERE account_id=$1', [account.id], db);
      await query('DELETE FROM notification_preferences WHERE account_id=$1', [account.id], db);
      await query('DELETE FROM challenges WHERE account_id=$1', [account.id], db);
      await query(
        'UPDATE sessions SET revoked_at=now(),device=$2 WHERE account_id=$1',
        [account.id, 'Deleted account'],
        db,
      );
      await query('DELETE FROM contact_messages WHERE sender_id=$1', [account.id], db);
      await query(
        "UPDATE jobs SET status='COMPLETED',completed_at=now(),payload='{}' WHERE (payload->>'accountId'=$1 OR payload->>'actorId'=$1) AND kind IN ('email','relay','provider-sync')",
        [account.id],
        db,
      );
      await query(
        "UPDATE accounts SET state='DELETED',email=$2,password_hash='DISABLED',totp_secret=NULL,totp_enabled=false,locale='en',timezone='UTC',verified_at=NULL WHERE id=$1",
        [account.id, account.id + '@deleted.invalid'],
        db,
      );
      await audit(db, account.id, null, 'account.deleted', r.requestId);
    });
    res.clearCookie('identity_session', { path: '/' });
    return { message: 'Account deleted and sessions revoked.' };
  }
}
