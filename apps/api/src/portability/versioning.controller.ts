import { Input } from '../input.js';
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { claimSchema, privatePolicy } from '../../../../packages/contracts/src/index.js';
import { blockSchema } from '../../../../packages/core/src/blocks.js';
import { IdentityService } from '../identity/identity.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
type Row = Record<string, unknown>;
const VersioningControllerrestoreInput = z.object({ proof: z.string().max(200) }).strict();
const VersioningControllerlifecycleInput = z
  .object({
    state: z.enum(['ACTIVE', 'LOCKED', 'ARCHIVED']),
    confirmHandle: z.string().max(30),
    proof: z.string().max(200),
  })
  .strict();
const VersioningControllertransferInput = z
  .object({
    accountId: z.string().max(100),
    confirmHandle: z.string().max(30),
    proof: z.string().max(200),
  })
  .strict();
@ApiTags('Conflict resolution, revisions and lifecycle')
@Controller('api/v1/identities/:id')
export class VersioningController {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Post('claims/:claim/select') async select(
    @Param('id') identityId: string,
    @Param('claim') claimId: string,
    @Req() r: ApiRequest,
  ) {
    const accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'claims', db);
      const c = requireValue(
        (
          await query<{
            key: string;
            persona_id: string | null;
            locale: string;
            assertion_id: string | null;
          }>(
            'SELECT * FROM claims WHERE id=$1 AND identity_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE',
            [claimId, identityId],
            db,
          )
        )[0],
        'Current claim unavailable',
      );
      if (c.assertion_id)
        requireValue(
          (
            await query(
              "SELECT 1 FROM enterprise_assertions a JOIN identities issuer ON issuer.id=a.issuer_id WHERE a.id=$1 AND a.state='ACCEPTED' AND a.revoked_at IS NULL AND a.expires_at>now() AND issuer.state='ACTIVE'",
              [c.assertion_id],
              db,
            )
          )[0],
          'Issuer assertion is no longer valid',
        );
      await this.identities.snapshot(db, identityId, accountId);
      await query(
        'UPDATE claims SET selected=false WHERE identity_id=$1 AND key=$2 AND persona_id IS NOT DISTINCT FROM $3 AND locale=$4',
        [identityId, c.key, c.persona_id, c.locale],
        db,
      );
      await query('UPDATE claims SET selected=true,updated_at=now() WHERE id=$1', [claimId], db);
      await event(db, identityId, accountId, 'claim.selected', r.requestId, {
        claimId,
        key: c.key,
      });
    });
    return {
      message:
        'Authoritative claim selected. Its existing privacy policy and provenance are preserved.',
    };
  }
  @Get('revisions/:revision') async revision(
    @Param('id') identityId: string,
    @Param('revision') revisionId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    const revision = requireValue(
      (
        await query<{ snapshot: { claims: Row[]; blocks?: Row[] } }>(
          'SELECT id,actor_id,revision,created_at,snapshot FROM revisions WHERE id=$1 AND identity_id=$2',
          [revisionId, identityId],
        )
      )[0],
      'Revision unavailable',
    );
    const current = await query<Row>(
      'SELECT id,key,value,persona_id,locale,source,selected,policy FROM claims WHERE identity_id=$1 AND selected AND revoked_at IS NULL',
      [identityId],
    );
    const before = new Map(
        revision.snapshot.claims
          .filter((c) => c.selected && !c.revoked_at)
          .map((c) => [[c.key, c.persona_id, c.locale].join('|'), c]),
      ),
      after = new Map(current.map((c) => [[c.key, c.persona_id, c.locale].join('|'), c]));
    const changes = [...new Set([...before.keys(), ...after.keys()])]
      .filter(
        (key) => JSON.stringify(before.get(key)?.value) !== JSON.stringify(after.get(key)?.value),
      )
      .map((key) => ({
        field: key,
        before: before.get(key)?.value ?? null,
        after: after.get(key)?.value ?? null,
      }));
    return {
      ...revision,
      changes,
      restoreBehavior:
        'Restores validated text claims privately as owner-entered copies. Issuer assertions, credentials, permissions, domain proofs and publication settings remain under their current authority. Blocks restore disabled and private.',
    };
  }
  @Input(VersioningControllerrestoreInput)
  @Post('revisions/:revision/restore')
  async restore(
    @Param('id') identityId: string,
    @Param('revision') revisionId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const { proof } = VersioningControllerrestoreInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, proof);
    let restored = 0,
      skipped = 0;
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (identity.state !== 'ACTIVE')
        throw new DomainError(
          'RESTORE_UNAVAILABLE',
          'Activate the identity before restoring content.',
        );
      const rev = requireValue(
        (
          await query<{ snapshot: { claims: Row[]; blocks?: Row[] } }>(
            'SELECT snapshot FROM revisions WHERE id=$1 AND identity_id=$2',
            [revisionId, identityId],
            db,
          )
        )[0],
        'Revision unavailable',
      );
      await this.identities.snapshot(db, identityId, accountId);
      for (const c of rev.snapshot.claims) {
        if (c.assertion_id) {
          skipped++;
          continue;
        }
        const parsed = claimSchema.safeParse({
          key: c.key,
          value: c.value,
          locale: c.locale,
          personaId: c.persona_id,
          policy: privatePolicy,
        });
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const d = parsed.data;
        if (
          d.personaId &&
          !(
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
              [d.personaId, identityId],
              db,
            )
          ).length
        ) {
          skipped++;
          continue;
        }
        await query(
          'UPDATE claims SET selected=false WHERE identity_id=$1 AND key=$2 AND persona_id IS NOT DISTINCT FROM $3 AND locale=$4',
          [identityId, d.key, d.personaId, d.locale],
          db,
        );
        await query(
          'INSERT INTO claims(id,identity_id,key,value,persona_id,locale,policy,actor_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            id('clm'),
            identityId,
            d.key,
            JSON.stringify(d.value),
            d.personaId,
            d.locale,
            JSON.stringify(privatePolicy),
            accountId,
            JSON.stringify({
              restoredRevision: revisionId,
              originalClaimId: c.id,
              originalSource: c.source,
            }),
          ],
          db,
        );
        restored++;
      }
      for (const b of rev.snapshot.blocks ?? []) {
        const parsed = blockSchema.safeParse({
          kind: b.kind,
          title: b.title,
          position: b.position,
          enabled: false,
          locale: b.locale,
          personaId: b.persona_id,
          configuration: b.configuration,
          policy: privatePolicy,
        });
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const d = parsed.data;
        if (
          d.personaId &&
          !(
            await query(
              'SELECT 1 FROM personas WHERE id=$1 AND identity_id=$2 AND active',
              [d.personaId, identityId],
              db,
            )
          ).length
        ) {
          skipped++;
          continue;
        }
        if (
          d.configuration.mediaIds.length &&
          (
            await query(
              "SELECT id FROM media WHERE identity_id=$1 AND status='READY' AND id=ANY($2::text[])",
              [identityId, d.configuration.mediaIds],
              db,
            )
          ).length !== new Set(d.configuration.mediaIds).size
        ) {
          skipped++;
          continue;
        }
        if (
          !(
            await query(
              'SELECT 1 FROM profile_blocks WHERE id=$1 AND identity_id=$2',
              [b.id, identityId],
              db,
            )
          ).length
        ) {
          const [count] = await query<{ count: string }>(
            'SELECT count(*) FROM profile_blocks WHERE identity_id=$1',
            [identityId],
            db,
          );
          if (Number(count!.count) >= 100) {
            skipped++;
            continue;
          }
          await query(
            'INSERT INTO profile_blocks(id,identity_id,kind,title,configuration,policy,position,persona_id,locale,enabled,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10)',
            [
              id('blk'),
              identityId,
              d.kind,
              d.title,
              JSON.stringify(d.configuration),
              JSON.stringify(privatePolicy),
              d.position,
              d.personaId,
              d.locale,
              accountId,
            ],
            db,
          );
          restored++;
          continue;
        }
        await query(
          'UPDATE profile_blocks SET kind=$3,title=$4,position=$5,enabled=false,locale=$6,persona_id=$7,configuration=$8,policy=$9,updated_at=now() WHERE id=$1 AND identity_id=$2',
          [
            b.id,
            identityId,
            d.kind,
            d.title,
            d.position,
            d.locale,
            d.personaId,
            JSON.stringify(d.configuration),
            JSON.stringify(privatePolicy),
          ],
          db,
        );
      }
      await event(db, identityId, accountId, 'profile.restored', r.requestId, {
        revisionId,
        restored,
        skipped,
      });
    });
    return {
      restored,
      skipped,
      message: 'Text claims restored privately. Review and publish each field deliberately.',
    };
  }
  @Input(VersioningControllerlifecycleInput)
  @Post('lifecycle')
  async lifecycle(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = VersioningControllerlifecycleInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, d.proof);
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (
        identity.handle !== d.confirmHandle ||
        !['ACTIVE', 'LOCKED', 'ARCHIVED'].includes(identity.state)
      )
        throw new DomainError(
          'INVALID_TRANSITION',
          'Confirm the current handle. Only active, owner-locked and archived identities can transition here.',
        );
      await this.identities.snapshot(db, identityId, accountId);
      await query(
        "UPDATE identities SET state=$2,visibility='PRIVATE',searchable=false,indexable=false,machine=false,agent=false,contact_enabled=false,federation_enabled=false WHERE id=$1",
        [identityId, d.state],
        db,
      );
      await query('UPDATE consents SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
      await event(db, identityId, accountId, 'identity.lifecycle_changed', r.requestId, {
        before: identity.state,
        after: d.state,
      });
    });
    return {
      message: 'Identity state changed. It remains private until explicitly published again.',
    };
  }
  @Input(VersioningControllertransferInput)
  @Post('transfer')
  async transfer(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = VersioningControllertransferInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, d.proof);
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (
        identity.state !== 'ACTIVE' ||
        identity.handle !== d.confirmHandle ||
        accountId === d.accountId
      )
        throw new DomainError(
          'INVALID_TRANSFER',
          'Confirm the active identity and a different accepted member.',
        );
      requireValue(
        (
          await query(
            "SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.identity_id=$1 AND m.account_id=$2 AND a.state='ACTIVE' AND a.verified_at IS NOT NULL",
            [identityId, d.accountId],
            db,
          )
        )[0],
        'Recipient must first accept a verified identity invitation',
      );
      await query(
        "UPDATE memberships SET role='OWNER' WHERE identity_id=$1 AND account_id=$2",
        [identityId, d.accountId],
        db,
      );
      await query(
        'DELETE FROM memberships WHERE identity_id=$1 AND account_id=$2',
        [identityId, accountId],
        db,
      );
      await query('UPDATE consents SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
      await query(
        "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE identity_id=$1",
        [identityId],
        db,
      );
      await query(
        'UPDATE legacy_policies SET revoked_at=now() WHERE identity_id=$1',
        [identityId],
        db,
      );
      await event(db, identityId, accountId, 'identity.transferred', r.requestId, {
        recipientId: d.accountId,
      });
    });
    return {
      message:
        'Ownership transferred to the accepted member. Prior owner access and grants revoked.',
    };
  }
}
