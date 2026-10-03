import { Input } from '../input.js';
import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { type ApiRequest } from '../http.js';
import { analyticsKinds, recordAggregate } from '../../../../packages/core/src/analytics.js';
const ActivityControlleractivityInput = z
  .object({
    kind: z.enum(analyticsKinds).exclude(['application_request', 'avatar_request', 'qr_scan']),
    persona: z.string().max(30).optional(),
  })
  .strict();
@ApiTags('Anonymous aggregate activity')
@Controller('api/v1/profiles')
export class ActivityController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Input(ActivityControlleractivityInput)
  @Post(':id/activity')
  async activity(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { kind, persona } = ActivityControlleractivityInput.parse(b);
    const p = await this.identities.profile(identityId, persona ?? null, 'human');
    await recordAggregate(p.id, kind, r.headers.dnt === '1' || r.headers['sec-gpc'] === '1');
    return { recorded: true };
  }
}
