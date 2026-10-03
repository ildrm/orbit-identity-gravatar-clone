import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Input } from '../input.js';
import { oauthClientSchema, oauthDecisionSchema } from '../../../../packages/core/src/oauth.js';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { config } from '../../../../packages/core/src/config.js';
import { OAuthError, oauthScopes } from '../../../../packages/core/src/oauth.js';
import { OAuthService } from './oauth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
@ApiTags('OAuth 2.0')
@Controller()
export class OAuthController {
  constructor(@Inject(OAuthService) private readonly oauth: OAuthService) {}
  @Get('.well-known/oauth-authorization-server') metadata() {
    const issuer = config().PUBLIC_ORIGIN;
    return {
      issuer,
      authorization_endpoint: issuer + '/api/v1/oauth/authorize',
      token_endpoint: issuer + '/api/v1/oauth/token',
      revocation_endpoint: issuer + '/api/v1/oauth/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
      scopes_supported: oauthScopes,
      authorization_response_iss_parameter_supported: true,
    };
  }
  @Input(oauthClientSchema)
  @Post('api/v1/oauth/clients')
  create(@Body() b: unknown, @Req() r: ApiRequest) {
    return this.oauth.create(requireAccount(r).id, b, r.requestId);
  }
  @Post('api/v1/oauth/clients/:id/rotate') rotate(@Param('id') id: string, @Req() r: ApiRequest) {
    return this.oauth.rotate(requireAccount(r).id, id, r.requestId);
  }
  @Get('api/v1/oauth/authorize') async authorize(
    @Query() q: Record<string, unknown>,
    @Req() r: ApiRequest,
    @Res() res: Response,
  ) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!r.account)
      return res.redirect(
        302,
        config().PUBLIC_ORIGIN + '/login?returnTo=' + encodeURIComponent(r.originalUrl),
      );
    return res.redirect(302, await this.oauth.begin(r.account.id, q));
  }
  @Get('api/v1/oauth/requests/:id') details(@Param('id') id: string, @Req() r: ApiRequest) {
    return this.oauth.details(requireAccount(r).id, id);
  }
  @Input(oauthDecisionSchema)
  @Post('api/v1/oauth/requests/:id/decision')
  decision(@Param('id') id: string, @Body() b: unknown, @Req() r: ApiRequest) {
    return this.oauth.decide(requireAccount(r).id, id, b, r.requestId);
  }
  @Post('api/v1/oauth/token')
  @HttpCode(200)
  async token(@Body() b: Record<string, unknown>, @Req() r: ApiRequest, @Res() res: Response) {
    return this.response(res, async () => {
      const parsed = z
        .object({
          grant_type: z.string().min(1).max(80),
          client_id: z.string().max(100).optional(),
          code: z.string().max(200).optional(),
          redirect_uri: z.string().max(2048).optional(),
          code_verifier: z.string().max(128).optional(),
          refresh_token: z.string().max(200).optional(),
          scope: z.string().max(500).optional(),
        })
        .strict()
        .safeParse(b);
      if (!r.is('application/x-www-form-urlencoded') || !parsed.success)
        throw new OAuthError('invalid_request', 'Use bounded, single-valued form parameters.');
      return this.oauth.token(parsed.data, r.headers.authorization);
    });
  }
  @Post('api/v1/oauth/revoke')
  @HttpCode(200)
  async revoke(@Body() b: Record<string, unknown>, @Req() r: ApiRequest, @Res() res: Response) {
    return this.response(res, async () => {
      const parsed = z
        .object({
          token: z.string().min(1).max(200),
          client_id: z.string().max(100).optional(),
          token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
        })
        .strict()
        .safeParse(b);
      if (!r.is('application/x-www-form-urlencoded') || !parsed.success)
        throw new OAuthError('invalid_request', 'Use bounded, single-valued form parameters.');
      return this.oauth.revoke(parsed.data, r.headers.authorization);
    });
  }
  @Get('api/v1/oauth/profile') async profile(@Req() r: ApiRequest, @Res() res: Response) {
    return this.response(res, async () => {
      const value = r.headers.authorization?.match(/^Bearer (oa_[A-Za-z0-9_-]+)$/)?.[1];
      if (!value) throw new OAuthError('invalid_token', 'Provide an OAuth access token.', 401);
      return this.oauth.profile(value, r.requestId);
    });
  }
  @Get('api/v1/oauth/credentials') async credentials(@Req() r: ApiRequest, @Res() res: Response) {
    return this.response(res, async () => {
      const token = r.headers.authorization?.match(/^Bearer (oa_[A-Za-z0-9_-]+)$/)?.[1];
      if (!token) throw new OAuthError('invalid_token', 'Provide an OAuth access token.', 401);
      return this.oauth.credentials(token, r.requestId);
    });
  }
  private async response(res: Response, action: () => Promise<unknown>) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    try {
      return res.status(200).json(await action());
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (error.status === 401)
        res.setHeader(
          'WWW-Authenticate',
          error.error === 'invalid_client' ? 'Basic realm="oauth"' : 'Bearer error="invalid_token"',
        );
      return res
        .status(error.status)
        .json({ error: error.error, error_description: error.message });
    }
  }
}
