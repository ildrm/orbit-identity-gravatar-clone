import { Input } from '../input.js';
import { Body, Controller, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { config } from '../../../../packages/core/src/config.js';
import { nodeKey } from '../../../../packages/core/src/federation.js';
import { nativeDid, privateSigningKey } from '../../../../packages/core/src/did.js';
import { approvedAttestation } from '../../../../packages/core/src/federation-migration.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { IdentityService } from '../identity/identity.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const FederationMigrationControllerchallengeInput = z
  .object({ target: z.url().max(2048) })
  .strict();
const FederationMigrationControlleracceptInput = z
  .object({
    source: z.url().max(2048),
    nonce: z.string().min(20).max(200),
    proof: z.string().max(200),
  })
  .strict();
const FederationMigrationControllercompleteInput = z
  .object({
    target: z.url().max(2048),
    acceptance: z.string().max(16000),
    confirmHandle: z.string().max(30),
    proof: z.string().max(200),
  })
  .strict();
@ApiTags('Proved cross-node migration')
@Controller('api/v1/identities/:id/federation/migration')
export class FederationMigrationController {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Input(FederationMigrationControllerchallengeInput)
  @Post('challenge')
  async challenge(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { target } = FederationMigrationControllerchallengeInput.parse(b),
      accountId = requireAccount(r).id,
      nonce = secret(),
      targetOrigin = new URL(target).origin;
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (identity.state !== 'ACTIVE' || !identity.federation_enabled)
        throw new DomainError(
          'MIGRATION_UNAVAILABLE',
          'Enable federation on the active source identity first.',
        );
      requireValue(
        (
          await query(
            'SELECT 1 FROM federation_peers WHERE origin=$1 AND blocked_at IS NULL',
            [targetOrigin],
            db,
          )
        )[0],
        'Destination node must be approved',
      );
      if (
        target !== targetOrigin + '/api/v1/profiles/' + target.split('/').at(-1) ||
        !/^idn_[a-f0-9]{32}$/.test(target.split('/').at(-1)!)
      )
        throw new DomainError(
          'INVALID_DESTINATION',
          'Choose a native actor URL on the destination node.',
        );
      await query(
        "INSERT INTO challenges(id,account_id,kind,digest,data,expires_at) VALUES($1,$2,'FEDERATION_MIGRATION',$3,$4,now()+interval '10 minutes')",
        [id('chl'), accountId, digest(nonce), JSON.stringify({ identityId, target })],
        db,
      );
    });
    return { source: config().PUBLIC_ORIGIN + '/api/v1/profiles/' + identityId, target, nonce };
  }
  @Input(FederationMigrationControlleracceptInput)
  @Post('accept')
  async accept(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = FederationMigrationControlleracceptInput.parse(b),
      accountId = requireAccount(r).id,
      sourceOrigin = new URL(d.source).origin;
    await this.auth.requireStepUp(accountId, d.proof);
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (
        identity.state !== 'ACTIVE' ||
        identity.visibility !== 'PUBLIC' ||
        !identity.machine ||
        !identity.federation_enabled
      )
        throw new DomainError(
          'MIGRATION_PRIVACY',
          'The destination must be an active public federated identity.',
        );
      requireValue(
        (
          await query(
            'SELECT 1 FROM federation_peers WHERE origin=$1 AND blocked_at IS NULL',
            [sourceOrigin],
            db,
          )
        )[0],
        'Source node must be approved',
      );
      if (
        d.source !== sourceOrigin + '/api/v1/profiles/' + d.source.split('/').at(-1) ||
        !/^idn_[a-f0-9]{32}$/.test(d.source.split('/').at(-1)!)
      )
        throw new DomainError('INVALID_SOURCE', 'Invalid native source actor URL.');
      await event(db, identityId, accountId, 'federation.migration_accepted', r.requestId, {
        source: d.source,
      });
    });
    const key = await nodeKey(),
      target = config().PUBLIC_ORIGIN + '/api/v1/profiles/' + identityId;
    const acceptance = await new SignJWT({ source: d.source, target, nonce: d.nonce })
      .setProtectedHeader({
        alg: 'EdDSA',
        typ: 'orbit-migration+jwt',
        kid: nativeDid() + '#' + key.id,
      })
      .setIssuer(nativeDid())
      .setAudience(sourceOrigin)
      .setJti(id('mig'))
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(await privateSigningKey(key));
    return { acceptance, expiresIn: 600 };
  }
  @Input(FederationMigrationControllercompleteInput)
  @Post('complete')
  async complete(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = FederationMigrationControllercompleteInput.parse(b),
      accountId = requireAccount(r).id,
      targetOrigin = new URL(d.target).origin;
    await this.auth.requireStepUp(accountId, d.proof);
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db),
        proof = await approvedAttestation(d.acceptance, targetOrigin, new Date(), db);
      if (
        identity.state !== 'ACTIVE' ||
        identity.handle !== d.confirmHandle ||
        proof.source !== config().PUBLIC_ORIGIN + '/api/v1/profiles/' + identityId ||
        proof.target !== d.target
      )
        throw new DomainError(
          'MIGRATION_BINDING',
          'Confirm the current source handle and exact destination.',
        );
      const challenge = requireValue(
        (
          await query<{ data: { identityId: string; target: string } }>(
            "UPDATE challenges SET used_at=now() WHERE account_id=$1 AND kind='FEDERATION_MIGRATION' AND digest=$2 AND expires_at>now() AND used_at IS NULL RETURNING data",
            [accountId, digest(proof.nonce)],
            db,
          )
        )[0],
        'Migration challenge expired or used',
      );
      if (challenge.data.identityId !== identityId || challenge.data.target !== d.target)
        throw new DomainError(
          'MIGRATION_BINDING',
          'Acceptance does not match the original challenge.',
        );
      await query(
        "UPDATE identities SET state='TRANSFERRED',migrated_to=$2,migrated_at=now(),migration_proof=$3,visibility='PRIVATE',searchable=false,indexable=false,machine=false,agent=false,contact_enabled=false,federation_enabled=false WHERE id=$1",
        [identityId, d.target, d.acceptance],
        db,
      );
      await query('UPDATE consents SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
      await query(
        "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE identity_id=$1",
        [identityId],
        db,
      );
      await query(
        "UPDATE domains SET revoked_at=now(),custom_enabled=false,canonical=false,routing_state='DISABLED' WHERE identity_id=$1",
        [identityId],
        db,
      );
      await event(db, identityId, accountId, 'federation.moved', r.requestId, { target: d.target });
    });
    return {
      movedTo: d.target,
      message:
        'Source archived and grants revoked. Export and import data separately before completing migration.',
    };
  }
}
