import { Input } from '../input.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { config } from '../../../../packages/core/src/config.js';
import { event, audit } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { digest } from '../../../../packages/core/src/security.js';
import {
  nodeDiscovery,
  nodeKey,
  approvePeer,
  receiveFederation,
} from '../../../../packages/core/src/federation.js';
import { AuthService } from '../auth/auth.service.js';
import { createSigningKey, documentFor } from '../../../../packages/core/src/did.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
function moderator(r: ApiRequest) {
  const account = requireAccount(r);
  if (
    !config()
      .MODERATOR_EMAILS.split(',')
      .map((v) => v.trim().toLowerCase())
      .includes(account.email)
  )
    throw new DomainError('FORBIDDEN', 'Node operator access required.', 403);
  return account;
}
const FederationControllerrotateInput = z.object({ proof: z.string().max(200) }).strict();
const FederationControllerrevokeInput = z.object({ proof: z.string().max(200) }).strict();
const FederationControllerinboxInput = z.object({ message: z.string().max(48000) }).strict();
const FederationControllerapproveInput = z
  .object({ origin: z.url().max(2048), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const FederationControllersettingsInput = z.object({ enabled: z.boolean() }).strict();
@ApiTags('Federation')
@Controller()
export class FederationController {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Input(FederationControllerrotateInput)
  @Post('api/v1/admin/federation/keys/rotate')
  async rotate(@Body() b: unknown, @Req() r: ApiRequest) {
    const account = moderator(r),
      { proof } = FederationControllerrotateInput.parse(b);
    await this.auth.requireStepUp(account.id, proof);
    await nodeKey();
    await transaction(async (db) => {
      await query('SELECT pg_advisory_xact_lock(718207)', [], db);
      const [count] = await query<{ count: string }>(
        "SELECT count(*) FROM signing_keys WHERE identity_id IS NULL AND state<>'REVOKED'",
        [],
        db,
      );
      if (Number(count!.count) >= 20)
        throw new DomainError('KEY_LIMIT', 'Revoke older node keys before rotating again.');
      await query(
        "UPDATE signing_keys SET state='RETIRED',retired_at=now() WHERE identity_id IS NULL AND state='ACTIVE'",
        [],
        db,
      );
      await createSigningKey(null, db);
      await audit(db, account.id, null, 'federation.key_rotated', r.requestId);
    });
    const document = await documentFor(null);
    return {
      document,
      fingerprint: digest(JSON.stringify(document)),
      message:
        'Share the new fingerprint through a trusted operator channel. Peers must block and explicitly reapprove this node.',
    };
  }
  @Input(FederationControllerrevokeInput)
  @Delete('api/v1/admin/federation/keys/:id')
  async revoke(@Param('id') keyId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const account = moderator(r),
      { proof } = FederationControllerrevokeInput.parse(b);
    await this.auth.requireStepUp(account.id, proof);
    await transaction(async (db) => {
      await query('SELECT pg_advisory_xact_lock(718207)', [], db);
      requireValue(
        (
          await query(
            "UPDATE signing_keys SET state='REVOKED',revoked_at=now(),private_encrypted='' WHERE id=$1 AND identity_id IS NULL RETURNING id",
            [keyId],
            db,
          )
        )[0],
        'Node key unavailable',
      );
      if (
        !(
          await query(
            "SELECT 1 FROM signing_keys WHERE identity_id IS NULL AND state='ACTIVE'",
            [],
            db,
          )
        ).length
      )
        await createSigningKey(null, db);
      await audit(db, account.id, null, 'federation.key_revoked', r.requestId, { keyId });
    });
    const document = await documentFor(null);
    return { document, fingerprint: digest(JSON.stringify(document)) };
  }
  @Get('.well-known/identity-federation') async discovery() {
    const d = await nodeDiscovery();
    return { ...d, fingerprint: digest(JSON.stringify(d.document)) };
  }
  @Get('.well-known/did.json') async did() {
    await nodeDiscovery();
    return documentFor(null);
  }
  @Input(FederationControllerinboxInput)
  @Post('api/v1/federation/inbox')
  @HttpCode(202)
  inbox(@Body() b: unknown) {
    const { message } = FederationControllerinboxInput.parse(b);
    return receiveFederation(message);
  }
  @Get('api/v1/admin/federation/peers') peers(@Req() r: ApiRequest) {
    moderator(r);
    return query(
      'SELECT id,origin,did,fingerprint,approved_at,blocked_at FROM federation_peers ORDER BY origin',
    );
  }
  @Input(FederationControllerapproveInput)
  @Post('api/v1/admin/federation/peers')
  async approve(@Body() b: unknown, @Req() r: ApiRequest) {
    const account = moderator(r),
      d = FederationControllerapproveInput.parse(b);
    await transaction(async (db) => {
      await approvePeer(account.id, d.origin, d.fingerprint, db);
      await audit(db, account.id, null, 'federation.peer_approved', r.requestId, {
        origin: d.origin,
      });
    });
    return { message: 'Peer keys pinned and federation approved.' };
  }
  @Delete('api/v1/admin/federation/peers/:id') async block(
    @Param('id') peerId: string,
    @Req() r: ApiRequest,
  ) {
    const account = moderator(r);
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            'UPDATE federation_peers SET blocked_at=now() WHERE id=$1 RETURNING id',
            [peerId],
            db,
          )
        )[0],
        'Peer unavailable',
      );
      await query(
        "UPDATE remote_profiles SET profile=NULL,state='DELETED' WHERE peer_id=$1",
        [peerId],
        db,
      );
      await query(
        "UPDATE jobs SET status='COMPLETED',completed_at=now(),payload='{}',lease_token=NULL WHERE kind='federation' AND payload->>'peerId'=$1",
        [peerId],
        db,
      );
      await audit(db, account.id, null, 'federation.peer_blocked', r.requestId, { peerId });
    });
    return { message: 'Peer blocked and cached profiles purged.' };
  }
  @Get('api/v1/identities/:id/federation') async status(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    const identity = await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return { enabled: Boolean(identity.federation_enabled) };
  }
  @Input(FederationControllersettingsInput)
  @Put('api/v1/identities/:id/federation')
  async settings(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { enabled } = FederationControllersettingsInput.parse(b),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (
        enabled &&
        (identity.state !== 'ACTIVE' || identity.visibility !== 'PUBLIC' || !identity.machine)
      )
        throw new DomainError(
          'FEDERATION_PRIVACY',
          'Publish your profile and enable machine access before federating.',
        );
      await query(
        'UPDATE identities SET federation_enabled=$2 WHERE id=$1',
        [identityId, enabled],
        db,
      );
      await event(db, identityId, accountId, 'federation.updated', r.requestId, { enabled });
    });
    return { enabled };
  }
  @Get('api/v1/federation/resolve') async resolve(@Query('actor') actor: string) {
    const value = z.url().max(2048).parse(actor);
    const profile = requireValue(
      (
        await query<{ profile: unknown; moved_to: string | null; state: string }>(
          "SELECT r.profile,r.moved_to,r.state FROM remote_profiles r JOIN federation_peers p ON p.id=r.peer_id WHERE r.actor=$1 AND p.blocked_at IS NULL AND (r.state='MOVED' OR r.expires_at>now()) AND r.state IN ('ACTIVE','MOVED') AND (r.state<>'MOVED' OR EXISTS(SELECT 1 FROM federation_peers destination WHERE r.moved_to LIKE destination.origin||'/api/v1/profiles/%' AND destination.blocked_at IS NULL))",
          [value],
        )
      )[0],
      'Remote identity unavailable',
    );
    return profile.state === 'MOVED' ? { movedTo: profile.moved_to } : profile.profile;
  }
}
