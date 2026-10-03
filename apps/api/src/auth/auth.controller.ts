import { Input } from '../input.js';
import { Controller, Post, Get, Delete, Body, Req, Res, Param, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { config } from '../../../../packages/core/src/config.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { audit } from '../../../../packages/core/src/events.js';
import { emailSchema, passwordSchema } from '../../../../packages/contracts/src/index.js';
import { requireAccount, type ApiRequest } from '../http.js';
const challenge = z.object({ token: z.string().min(20).max(200) }).strict();
const AuthControllerverifyInput = challenge;
const AuthControllerrecoverInput = z.object({ email: emailSchema }).strict();
const AuthControllerresetInput = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
    code: z.string().max(20).optional(),
  })
  .strict();
const AuthControllerstepupInput = z
  .object({ password: z.string().max(128), code: z.string().max(20).optional() })
  .strict();
const AuthControllersetupTotpInput = z.object({ proof: z.string().max(200) }).strict();
const AuthControllerconfirmTotpInput = z
  .object({ token: z.string(), code: z.string().regex(/^\d{6}$/) })
  .strict();
@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post('register')
  @ApiOperation({ summary: 'Register and send a verification email' })
  register(@Body() body: unknown, @Req() req: ApiRequest) {
    return this.auth.register(body, req.requestId);
  }
  @Input(AuthControllerverifyInput)
  @Post('verify')
  async verify(@Body() body: unknown, @Req() req: ApiRequest) {
    await this.auth.verify(AuthControllerverifyInput.parse(body).token, req.requestId);
    return { message: 'Email verified. You can sign in.' };
  }
  @Post('login') async login(
    @Body() body: unknown,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      body,
      req.headers['user-agent'] ?? 'Unknown device',
      req.requestId,
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
  @Get('me') me(@Req() req: ApiRequest) {
    return requireAccount(req);
  }
  @Post('logout') async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(
      (req.cookies as Record<string, string>)?.identity_session ?? '',
      req.requestId,
    );
    res.clearCookie('identity_session', { path: '/' });
    return { message: 'Signed out' };
  }
  @Input(AuthControllerrecoverInput)
  @Post('recover')
  async recover(@Body() body: unknown) {
    const { email } = AuthControllerrecoverInput.parse(body);
    await this.auth.recovery(email);
    return { message: 'If the account is eligible, a recovery email is on its way.' };
  }
  @Input(AuthControllerresetInput)
  @Post('reset')
  async reset(@Body() body: unknown, @Req() req: ApiRequest) {
    const d = AuthControllerresetInput.parse(body);
    await this.auth.resetPassword(d.token, d.password, d.code, req.requestId);
    return { message: 'Password changed. Sign in again.' };
  }
  @Get('sessions') sessions(@Req() req: ApiRequest) {
    return query(
      'SELECT id,device,created_at,last_seen_at,expires_at FROM sessions WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC',
      [requireAccount(req).id],
    );
  }
  @Delete('sessions/:id') async revoke(@Param('id') sessionId: string, @Req() req: ApiRequest) {
    const a = requireAccount(req);
    await transaction(async (db) => {
      await query(
        'UPDATE sessions SET revoked_at=now() WHERE id=$1 AND account_id=$2',
        [sessionId, a.id],
        db,
      );
      await audit(db, a.id, null, 'session.revoked', req.requestId);
    });
    return { message: 'Session revoked' };
  }
  @Input(AuthControllerstepupInput)
  @Post('stepup')
  stepup(@Body() body: unknown, @Req() req: ApiRequest) {
    const d = AuthControllerstepupInput.parse(body);
    return this.auth.stepUp(requireAccount(req).id, d.password, d.code, req.requestId);
  }
  @Input(AuthControllersetupTotpInput)
  @Post('totp/setup')
  async setupTotp(@Body() body: unknown, @Req() req: ApiRequest) {
    const a = requireAccount(req),
      d = AuthControllersetupTotpInput.parse(body);
    await this.auth.requireStepUp(a.id, d.proof);
    return this.auth.beginTotp(a);
  }
  @Input(AuthControllerconfirmTotpInput)
  @Post('totp/confirm')
  async confirmTotp(@Body() body: unknown, @Req() req: ApiRequest) {
    const d = AuthControllerconfirmTotpInput.parse(body);
    return {
      backupCodes: await this.auth.confirmTotp(requireAccount(req), d.token, d.code, req.requestId),
    };
  }
}
