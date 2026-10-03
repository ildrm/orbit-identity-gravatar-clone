import { Controller, Get, Post, Delete, Body, Param, Req, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApplicationsService } from './applications.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { DomainError } from '../../../../packages/core/src/errors.js';
@ApiTags('Developer applications and consent')
@Controller('api/v1')
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly apps: ApplicationsService) {}
  @Get('application') client(@Req() r: ApiRequest) {
    const token = r.headers.authorization?.match(/^Bearer (ik_[A-Za-z0-9_-]+)$/)?.[1];
    if (!token) throw new DomainError('INVALID_TOKEN', 'Provide an application credential.', 401);
    return this.apps.clientInfo(token);
  }
  @Get('applications') list(@Req() r: ApiRequest) {
    return this.apps.list(requireAccount(r).id);
  }
  @Post('applications') create(@Body() b: unknown, @Req() r: ApiRequest) {
    return this.apps.create(requireAccount(r).id, b, r.requestId);
  }
  @Delete('applications/:id') revoke(@Param('id') id: string, @Req() r: ApiRequest) {
    return this.apps.revoke(requireAccount(r).id, id, r.requestId);
  }
  @Post('applications/:id/rotate') rotate(@Param('id') id: string, @Req() r: ApiRequest) {
    return this.apps.rotate(requireAccount(r).id, id, r.requestId);
  }
  @Get('identities/:id/consents') consents(@Param('id') id: string, @Req() r: ApiRequest) {
    return this.apps.consents(requireAccount(r).id, id);
  }
  @Post('identities/:id/consents') grant(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    return this.apps.grant(requireAccount(r).id, id, b, r.requestId);
  }
  @Delete('identities/:id/consents/:consent') revokeConsent(
    @Param('id') id: string,
    @Param('consent') consent: string,
    @Req() r: ApiRequest,
  ) {
    return this.apps.revokeConsent(requireAccount(r).id, id, consent, r.requestId);
  }
  @Get('application/profile') profile(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = r.headers.authorization?.match(/^Bearer (ic_[A-Za-z0-9_-]+)$/)?.[1];
    if (!token) throw new DomainError('INVALID_TOKEN', 'Provide a consent access token.', 401);
    res.setHeader('Cache-Control', 'no-store');
    return this.apps.consentedProfile(token, r.requestId);
  }
  @Get('application/credentials') credentials(@Req() r: ApiRequest) {
    const token = r.headers.authorization?.match(/^Bearer (ic_[A-Za-z0-9_-]+)$/)?.[1];
    if (!token) throw new DomainError('INVALID_TOKEN', 'Provide a native consent token.', 401);
    return this.apps.consentedCredentials(token, r.requestId);
  }
  @Get('applications/:id/webhooks') webhooks(@Param('id') id: string, @Req() r: ApiRequest) {
    return this.apps.webhooks(requireAccount(r).id, id);
  }
  @Post('applications/:id/webhooks') webhook(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    return this.apps.addWebhook(requireAccount(r).id, id, b, r.requestId);
  }
}
