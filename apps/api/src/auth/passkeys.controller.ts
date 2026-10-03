import { Input } from '../input.js';
import { Controller, Get, Post, Delete, Body, Param, Req, Res, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthService, type Account } from './auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { audit } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { config } from '../../../../packages/core/src/config.js';
const PasskeysControllerregistrationOptionsInput = z
  .object({ proof: z.string().max(200) })
  .strict();
const PasskeysControllerregistrationVerifyInput = z
  .object({
    token: z.string().max(200),
    name: z.string().min(1).max(80),
    response: z
      .object({
        id: z.string(),
        rawId: z.string(),
        type: z.literal('public-key'),
        response: z.record(z.string(), z.unknown()),
        clientExtensionResults: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .strict();
const PasskeysControllerauthenticationVerifyInput = z
  .object({
    token: z.string().max(200),
    response: z
      .object({
        id: z.string(),
        rawId: z.string(),
        type: z.literal('public-key'),
        response: z.record(z.string(), z.unknown()),
        clientExtensionResults: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .strict();
const PasskeysControllerremoveInput = z.object({ proof: z.string().max(200) }).strict();
@ApiTags('Passkeys')
@Controller('api/v1/auth/passkeys')
export class PasskeysController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get() list(@Req() r: ApiRequest) {
    return query('SELECT id,name,created_at FROM passkeys WHERE account_id=$1', [
      requireAccount(r).id,
    ]);
  }
  @Input(PasskeysControllerregistrationOptionsInput)
  @Post('registration/options')
  async registrationOptions(@Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = PasskeysControllerregistrationOptionsInput.parse(b);
    await this.auth.requireStepUp(a.id, d.proof);
    const keys = await query<{ id: string }>('SELECT id FROM passkeys WHERE account_id=$1', [a.id]);
    const options = await generateRegistrationOptions({
      rpName: 'Identity',
      rpID: config().RP_ID,
      userName: a.email,
      userDisplayName: a.email,
      userID: Buffer.from(a.id),
      attestationType: 'none',
      excludeCredentials: keys.map((k) => ({ id: k.id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const token = secret();
    await query(
      "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'PASSKEY_REGISTER',$3,$4,now()+interval '5 minutes')",
      [id('chl'), a.id, digest(token), JSON.stringify({ challenge: options.challenge })],
    );
    return { token, options };
  }
  @Input(PasskeysControllerregistrationVerifyInput)
  @Post('registration/verify')
  async registrationVerify(@Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = PasskeysControllerregistrationVerifyInput.parse(b);
    await transaction(async (db) => {
      const c = requireValue(
        (
          await query<{ data: { challenge: string } }>(
            "SELECT data FROM challenges WHERE digest=$1 AND account_id=$2 AND kind='PASSKEY_REGISTER' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
            [digest(d.token), a.id],
            db,
          )
        )[0],
        'Passkey challenge expired.',
      );
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: d.response as unknown as RegistrationResponseJSON,
          expectedChallenge: c.data.challenge,
          expectedOrigin: config().PUBLIC_ORIGIN,
          expectedRPID: config().RP_ID,
          requireUserVerification: true,
        });
      } catch {
        throw new DomainError('PASSKEY_FAILED', 'Passkey verification failed. Restart setup.');
      }
      if (!verification.verified || !verification.registrationInfo)
        throw new DomainError('PASSKEY_FAILED', 'Passkey verification failed.');
      const credential = verification.registrationInfo.credential;
      await query(
        'INSERT INTO passkeys(id,account_id,public_key,counter,transports,name) VALUES($1,$2,$3,$4,$5,$6)',
        [
          credential.id,
          a.id,
          Buffer.from(credential.publicKey),
          credential.counter,
          JSON.stringify(credential.transports ?? []),
          d.name,
        ],
        db,
      );
      await query('UPDATE challenges SET used_at=now() WHERE digest=$1', [digest(d.token)], db);
      await audit(db, a.id, null, 'passkey.created', r.requestId);
    });
    return { message: 'Passkey added' };
  }
  @Post('authentication/options') async authenticationOptions() {
    const options = await generateAuthenticationOptions({
        rpID: config().RP_ID,
        userVerification: 'required',
      }),
      token = secret();
    await query(
      "INSERT INTO challenges(id,kind,digest,data,expires_at) VALUES($1,'PASSKEY_AUTH',$2,$3,now()+interval '5 minutes')",
      [id('chl'), digest(token), JSON.stringify({ challenge: options.challenge })],
    );
    return { token, options };
  }
  @Input(PasskeysControllerauthenticationVerifyInput)
  @Post('authentication/verify')
  async authenticationVerify(
    @Body() b: unknown,
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = PasskeysControllerauthenticationVerifyInput.parse(b);
    const account = await transaction(async (db) => {
      const c = requireValue(
        (
          await query<{ data: { challenge: string } }>(
            "SELECT data FROM challenges WHERE digest=$1 AND kind='PASSKEY_AUTH' AND used_at IS NULL AND expires_at>now() FOR UPDATE",
            [digest(d.token)],
            db,
          )
        )[0],
        'Passkey challenge expired.',
      );
      const k = requireValue(
        (
          await query<{
            account_id: string;
            public_key: Buffer;
            counter: string;
            transports: ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[];
          }>('SELECT * FROM passkeys WHERE id=$1 FOR UPDATE', [d.response.id], db)
        )[0],
        'Passkey unavailable.',
      );
      let v;
      try {
        v = await verifyAuthenticationResponse({
          response: d.response as unknown as AuthenticationResponseJSON,
          expectedChallenge: c.data.challenge,
          expectedOrigin: config().PUBLIC_ORIGIN,
          expectedRPID: config().RP_ID,
          requireUserVerification: true,
          credential: {
            id: d.response.id,
            publicKey: new Uint8Array(k.public_key),
            counter: Number(k.counter),
            transports: k.transports,
          },
        });
      } catch {
        throw new DomainError('PASSKEY_FAILED', 'Passkey sign-in could not be verified.', 401);
      }
      if (!v.verified)
        throw new DomainError('PASSKEY_FAILED', 'Passkey sign-in could not be verified.', 401);
      const a = requireValue(
        (
          await query<Account>(
            "SELECT id,email,verified_at,state,locale,timezone,totp_enabled FROM accounts WHERE id=$1 AND state='ACTIVE' AND verified_at IS NOT NULL",
            [k.account_id],
            db,
          )
        )[0],
      );
      await query(
        'UPDATE passkeys SET counter=$1 WHERE id=$2',
        [v.authenticationInfo.newCounter, d.response.id],
        db,
      );
      await query('UPDATE challenges SET used_at=now() WHERE digest=$1', [digest(d.token)], db);
      return a;
    });
    const result = await this.auth.createSession(
      account,
      r.headers['user-agent'] ?? 'Passkey device',
      r.requestId,
    );
    res.cookie('identity_session', result.token, {
      httpOnly: true,
      secure: config().NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 14 * 86400000,
      path: '/',
    });
    return result.account;
  }
  @Input(PasskeysControllerremoveInput)
  @Delete(':id')
  async remove(@Param('id') keyId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = PasskeysControllerremoveInput.parse(b);
    await this.auth.requireStepUp(a.id, d.proof);
    await transaction(async (db) => {
      await query('DELETE FROM passkeys WHERE id=$1 AND account_id=$2', [keyId, a.id], db);
      await audit(db, a.id, null, 'passkey.removed', r.requestId);
    });
    return { message: 'Passkey removed' };
  }
}
