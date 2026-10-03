import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ApiRequest } from '../http.js';
import { DomainError } from '../../../../packages/core/src/errors.js';
import { consentedAvatar } from '../../../../packages/core/src/consented-avatar.js';

@ApiTags('Consented private avatar delivery')
@Controller('api/v1')
export class ConsentedAvatarController {
  private async deliver(
    r: ApiRequest,
    response: Response,
    q: Record<string, unknown>,
    oauth: boolean,
  ) {
    const token = r.headers.authorization?.match(
      oauth ? /^Bearer (oa_[A-Za-z0-9_-]+)$/ : /^Bearer (ic_[A-Za-z0-9_-]+)$/,
    )?.[1];
    if (!token)
      throw new DomainError('INVALID_TOKEN', 'Provide the current consent access token.', 401);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    const result = await consentedAvatar(token, oauth, q, r.requestId);
    response.type(result.contentType).send(result.bytes);
  }
  @Get('application/avatar') native(
    @Req() r: ApiRequest,
    @Res() response: Response,
    @Query() q: Record<string, unknown>,
  ) {
    return this.deliver(r, response, q, false);
  }
  @Get('oauth/avatar') oauth(
    @Req() r: ApiRequest,
    @Res() response: Response,
    @Query() q: Record<string, unknown>,
  ) {
    return this.deliver(r, response, q, true);
  }
}
