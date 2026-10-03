import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest, encrypt, decrypt } from '../../../../packages/core/src/security.js';
import { audit, enqueue } from '../../../../packages/core/src/events.js';
import { DomainError } from '../../../../packages/core/src/errors.js';
import { registerSchema, loginSchema } from '../../../../packages/contracts/src/index.js';
import * as OTPAuth from 'otpauth';
import type { Request } from 'express';
export interface Account {
  id: string;
  email: string;
  verified_at: Date | null;
  state: string;
  locale: string;
  timezone: string;
  totp_enabled: boolean;
}
interface AccountRow extends Account {
  password_hash: string;
  totp_secret: string | null;
}
const hashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;
let dummyHash: Promise<string> | undefined;
@Injectable()
export class AuthService {
  async register(input: unknown, requestId: string): Promise<{ message: string }> {
    const data = registerSchema.parse(input);
    const hash = await argon2.hash(data.password, hashOptions);
    await transaction(async (db) => {
      const accountId = id('acc');
      const rows = await query(
        'INSERT INTO accounts(id,email,password_hash,locale,timezone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id',
        [accountId, data.email, hash, data.locale, data.timezone],
        db,
      );
      if (rows.length) {
        const token = secret();
        await query(
          "INSERT INTO challenges(id,account_id,kind,digest,expires_at) VALUES($1,$2,'VERIFY_EMAIL',$3,now()+interval '24 hours')",
          [id('chl'), accountId, digest(token)],
          db,
        );
        await enqueue(db, 'email', { to: data.email, template: 'verify', token, accountId });
        await audit(db, accountId, null, 'account.registered', requestId);
      }
    });
    return { message: 'If this address can be registered, a verification email is on its way.' };
  }
  async verify(token: string, requestId: string): Promise<void> {
    await transaction(async (db) => {
      const rows = await query<{ account_id: string }>(
        "UPDATE challenges SET used_at=now() WHERE digest=$1 AND kind='VERIFY_EMAIL' AND used_at IS NULL AND expires_at>now() RETURNING account_id",
        [digest(token)],
        db,
      );
      if (!rows[0])
        throw new DomainError('INVALID_CHALLENGE', 'This link has expired or was already used.');
      await query('UPDATE accounts SET verified_at=now() WHERE id=$1', [rows[0].account_id], db);
      await audit(db, rows[0].account_id, null, 'account.verified', requestId);
    });
  }
  private async verifySecondFactor(account: AccountRow, code?: string): Promise<boolean> {
    if (!account.totp_enabled) return true;
    if (!code) return false;
    const totp = new OTPAuth.TOTP({
      issuer: 'Identity',
      label: account.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(decrypt(account.totp_secret!)),
    });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta !== null) {
      const step = Math.floor(Date.now() / 30000) + delta;
      return (
        (
          await query(
            'UPDATE accounts SET totp_last_step=$1 WHERE id=$2 AND (totp_last_step IS NULL OR totp_last_step<$1) RETURNING id',
            [step, account.id],
          )
        ).length > 0
      );
    }
    return (
      (
        await query(
          'UPDATE backup_codes SET used_at=now() WHERE account_id=$1 AND digest=$2 AND used_at IS NULL RETURNING digest',
          [account.id, digest(code)],
        )
      ).length > 0
    );
  }
  async login(
    input: unknown,
    device: string,
    requestId: string,
  ): Promise<{ token: string; account: Account }> {
    const data = loginSchema.parse(input);
    const [account] = await query<AccountRow>('SELECT * FROM accounts WHERE email=$1', [
      data.email,
    ]);
    const hash =
      (account?.state === 'ACTIVE' ? account.password_hash : undefined) ??
      (await (dummyHash ??= argon2.hash(secret(), hashOptions)));
    const valid = await argon2.verify(hash, data.password);
    if (
      !valid ||
      !account ||
      account.state !== 'ACTIVE' ||
      !account.verified_at ||
      !(await this.verifySecondFactor(account, data.code))
    )
      throw new DomainError(
        'LOGIN_FAILED',
        'Check your email, password and security code. Verify your email before signing in.',
        401,
      );
    return this.createSession(account, device, requestId);
  }
  async createSession(
    account: Account,
    device: string,
    requestId: string,
  ): Promise<{ token: string; account: Account }> {
    const token = secret();
    await transaction(async (db) => {
      await query(
        "INSERT INTO sessions(id,account_id,digest,device,expires_at) VALUES($1,$2,$3,$4,now()+interval '14 days')",
        [id('ses'), account.id, digest(token), device.slice(0, 250)],
        db,
      );
      await audit(db, account.id, null, 'session.created', requestId);
    });
    return { token, account: this.safeAccount(account) };
  }
  safeAccount(account: Account): Account {
    return {
      id: account.id,
      email: account.email,
      verified_at: account.verified_at,
      state: account.state,
      locale: account.locale,
      timezone: account.timezone,
      totp_enabled: account.totp_enabled,
    };
  }
  async authenticate(req: Request): Promise<Account | undefined> {
    const token = (req.cookies as Record<string, string> | undefined)?.identity_session;
    if (!token) return;
    const [account] = await query<AccountRow>(
      "SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.state='ACTIVE'",
      [digest(token)],
    );
    return account ? this.safeAccount(account) : undefined;
  }
  async logout(token: string, requestId: string): Promise<void> {
    await transaction(async (db) => {
      const [s] = await query<{ account_id: string }>(
        'UPDATE sessions SET revoked_at=now() WHERE digest=$1 RETURNING account_id',
        [digest(token)],
        db,
      );
      if (s) await audit(db, s.account_id, null, 'session.revoked', requestId);
    });
  }
  async recovery(email: string): Promise<void> {
    const [a] = await query<Account>(
      "SELECT * FROM accounts WHERE email=$1 AND state='ACTIVE' AND verified_at IS NOT NULL",
      [email],
    );
    if (!a) return;
    const token = secret();
    await transaction(async (db) => {
      await query(
        "INSERT INTO challenges(id,account_id,kind,digest,expires_at) VALUES($1,$2,'RESET_PASSWORD',$3,now()+interval '30 minutes')",
        [id('chl'), a.id, digest(token)],
        db,
      );
      await enqueue(db, 'email', { to: a.email, template: 'recovery', token, accountId: a.id });
    });
  }
  async resetPassword(
    token: string,
    password: string,
    code: string | undefined,
    requestId: string,
  ): Promise<void> {
    const hash = await argon2.hash(password, hashOptions);
    await transaction(async (db) => {
      const [c] = await query<{ account_id: string }>(
        "SELECT account_id FROM challenges WHERE digest=$1 AND kind='RESET_PASSWORD' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [digest(token)],
        db,
      );
      if (!c)
        throw new DomainError('INVALID_CHALLENGE', 'This link has expired or was already used.');
      const [a] = await query<AccountRow>('SELECT * FROM accounts WHERE id=$1', [c.account_id], db);
      if (!a || !(await this.verifySecondFactor(a, code)))
        throw new DomainError(
          'SECURITY_CODE_REQUIRED',
          'Provide your security code or an unused backup code.',
          401,
        );
      await query('UPDATE challenges SET used_at=now() WHERE digest=$1', [digest(token)], db);
      await query('UPDATE accounts SET password_hash=$1 WHERE id=$2', [hash, c.account_id], db);
      await query('UPDATE sessions SET revoked_at=now() WHERE account_id=$1', [c.account_id], db);
      await audit(db, c.account_id, null, 'account.password_reset', requestId);
    });
  }
  async stepUp(
    accountId: string,
    password: string,
    code: string | undefined,
    requestId: string,
  ): Promise<{ proof: string }> {
    const [account] = await query<AccountRow>(
      "SELECT * FROM accounts WHERE id=$1 AND state='ACTIVE'",
      [accountId],
    );
    if (
      !account ||
      !(await argon2.verify(account.password_hash, password)) ||
      !(await this.verifySecondFactor(account, code))
    )
      throw new DomainError(
        'STEP_UP_FAILED',
        'Confirm your password and current security code.',
        401,
      );
    const proof = secret();
    await transaction(async (db) => {
      await query(
        "INSERT INTO challenges(id,account_id,kind,digest,expires_at) VALUES($1,$2,'STEP_UP',$3,now()+interval '5 minutes')",
        [id('chl'), accountId, digest(proof)],
        db,
      );
      await audit(db, accountId, null, 'account.reauthenticated', requestId);
    });
    return { proof };
  }
  async requireStepUp(accountId: string, proof: string): Promise<void> {
    const rows = await query(
      "UPDATE challenges SET used_at=now() WHERE digest=$1 AND account_id=$2 AND kind='STEP_UP' AND used_at IS NULL AND expires_at>now() RETURNING id",
      [digest(proof), accountId],
    );
    if (!rows.length)
      throw new DomainError(
        'STEP_UP_REQUIRED',
        'Confirm your password before changing account security.',
        403,
      );
  }
  async beginTotp(account: Account): Promise<{ token: string; uri: string }> {
    const totp = new OTPAuth.TOTP({
      issuer: 'Identity',
      label: account.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const token = secret();
    await query(
      "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'TOTP_SETUP',$3,$4,now()+interval '10 minutes')",
      [
        id('chl'),
        account.id,
        digest(token),
        JSON.stringify({ secret: encrypt(totp.secret.base32) }),
      ],
    );
    return { token, uri: totp.toString() };
  }
  async confirmTotp(
    account: Account,
    token: string,
    code: string,
    requestId: string,
  ): Promise<string[]> {
    return transaction(async (db) => {
      const [c] = await query<{ data: { secret: string } }>(
        "SELECT data FROM challenges WHERE digest=$1 AND account_id=$2 AND kind='TOTP_SETUP' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
        [digest(token), account.id],
        db,
      );
      if (!c) throw new DomainError('INVALID_CHALLENGE', 'Restart authenticator setup.');
      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(decrypt(c.data.secret)),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null)
        throw new DomainError('INVALID_CODE', 'Check the six-digit code and device time.');
      await query(
        'UPDATE accounts SET totp_secret=$1,totp_enabled=true,totp_last_step=$3 WHERE id=$2',
        [c.data.secret, account.id, Math.floor(Date.now() / 30000) + delta],
        db,
      );
      await query('UPDATE challenges SET used_at=now() WHERE digest=$1', [digest(token)], db);
      await query('DELETE FROM backup_codes WHERE account_id=$1', [account.id], db);
      const codes = Array.from({ length: 10 }, () => secret().slice(0, 16));
      for (const code of codes)
        await query(
          'INSERT INTO backup_codes(account_id,digest) VALUES($1,$2)',
          [account.id, digest(code)],
          db,
        );
      await audit(db, account.id, null, 'account.totp_enabled', requestId);
      return codes;
    });
  }
}
