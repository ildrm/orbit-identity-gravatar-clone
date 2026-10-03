import { Input } from '../input.js';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Inject,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityService } from './identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { handleSchema } from '../../../../packages/contracts/src/index.js';
import { query } from '../../../../packages/core/src/db.js';
const IdentityControllerrenameInput = z.object({ handle: handleSchema }).strict();
@ApiTags('Identities')
@Controller('api/v1/identities')
export class IdentityController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get() list(@Req() req: ApiRequest) {
    return this.identities.list(requireAccount(req).id);
  }
  @Post() create(@Body() body: unknown, @Req() req: ApiRequest) {
    return this.identities.create(requireAccount(req).id, body, req.requestId);
  }
  @Get(':id') async get(
    @Param('id') identityId: string,
    @Query('persona') persona: string | undefined,
    @Req() req: ApiRequest,
  ) {
    const account = requireAccount(req);
    await this.identities.authorize(account.id, identityId, 'read');
    return this.identities.profile(identityId, persona ?? null, 'human', {
      owner: true,
      accountId: account.id,
    });
  }
  @Input(IdentityControllerrenameInput)
  @Put(':id/handle')
  rename(@Param('id') identityId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    return this.identities.rename(
      requireAccount(req).id,
      identityId,
      IdentityControllerrenameInput.parse(body).handle,
      req.requestId,
    );
  }
  @Put(':id/settings') settings(
    @Param('id') identityId: string,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    return this.identities.settings(requireAccount(req).id, identityId, body, req.requestId);
  }
  @Get(':id/claims') claims(@Param('id') identityId: string, @Req() req: ApiRequest) {
    return this.identities.claims(requireAccount(req).id, identityId);
  }
  @Put(':id/claims') claim(
    @Param('id') identityId: string,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    return this.identities.putClaim(requireAccount(req).id, identityId, body, req.requestId);
  }
  @Delete(':id/claims/:claim') revoke(
    @Param('id') identityId: string,
    @Param('claim') claim: string,
    @Req() req: ApiRequest,
  ) {
    return this.identities.revokeClaim(requireAccount(req).id, identityId, claim, req.requestId);
  }
  @Get(':id/personas') personas(@Param('id') identityId: string, @Req() req: ApiRequest) {
    return this.identities.personas(requireAccount(req).id, identityId);
  }
  @Post(':id/personas') persona(
    @Param('id') identityId: string,
    @Body() body: unknown,
    @Req() req: ApiRequest,
  ) {
    return this.identities.createPersona(requireAccount(req).id, identityId, body, req.requestId);
  }
  @Get(':id/audit') async audit(@Param('id') identityId: string, @Req() req: ApiRequest) {
    await this.identities.authorize(requireAccount(req).id, identityId, 'read');
    return query(
      'SELECT id,actor_id,action,request_id,data,created_at FROM audit WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 100',
      [identityId],
    );
  }
  @Get(':id/revisions') async revisions(@Param('id') identityId: string, @Req() req: ApiRequest) {
    await this.identities.authorize(requireAccount(req).id, identityId, 'read');
    return query(
      'SELECT id,actor_id,revision,created_at FROM revisions WHERE identity_id=$1 ORDER BY revision DESC LIMIT 100',
      [identityId],
    );
  }
}
